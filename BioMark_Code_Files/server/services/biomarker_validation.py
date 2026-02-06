"""Biomarker validation service that outputs gene-disease and microRNA-disease matches."""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import warnings
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# Suppress urllib3 SSL warnings (LibreSSL compatibility)
warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")

import requests


MYGENE_ENDPOINT = "https://mygene.info/v3/query"
OPEN_TARGETS_ENDPOINT = "https://api.platform.opentargets.org/api/v4/graphql"
OPEN_TARGETS_QUERY = (
	"""
	query targetAssociations($ensemblId: String!, $size: Int!) {
		target(ensemblId: $ensemblId) {
			id
			approvedSymbol
			associatedDiseases(page: { index: 0, size: $size }) {
				rows {
					score
					disease {
						id
						name
					}
					datasourceScores {
						id
						score
					}
				}
			}
		}
	}
	"""
)

# JensenLab DISEASES database
JENSENLAB_DATA_FILE = os.path.join(os.path.dirname(__file__), "jensenlab_diseases.tsv")
JENSENLAB_MAX_ZSCORE = 10.0  # JensenLab z-scores typically range 0-10

# EWAS Atlas API for DNA methylation CpG sites
EWAS_ATLAS_API = "https://ngdc.cncb.ac.cn/ewas/rest/probe"
EWAS_ATLAS_BROWSE_URL = "https://ngdc.cncb.ac.cn/ewas/browse?probeId="

# miRBase fallback URL
MIRBASE_SEARCH_URL = "https://www.mirbase.org/results/?query="

DEFAULT_MAX_GENES = 10
ABSOLUTE_MAX_GENES = 100

# Pattern to detect MATURE microRNAs (must end with -5p or -3p suffix)
# Examples: hsa-miR-132-3p, hsa-let-7a-5p
# miRNA genes like "hsa-miR-132" or "MIR132" should go to Open Targets
MATURE_MIRNA_PATTERN = re.compile(r"^(hsa|mmu|rno|ebv|kshv|hcmv|hsv\d*)-(?:mir|miR|let)-.*-[35]p$", re.IGNORECASE)

TABLE_COLUMNS = [
	{"key": "biomarkerSymbol", "label": "Biomarker"},
	{"key": "biomarkerType", "label": "Type"},
	{"key": "biomarkerName", "label": "Name"},
	{"key": "disease", "label": "Disease / Condition"},
	{"key": "score", "label": "Association Score"},
	{"key": "source", "label": "Source"},
]


# ---------------------------------------------------------------------------
# JensenLab DISEASES Database
# ---------------------------------------------------------------------------

class JensenLabDatabase:
	"""In-memory database for JensenLab DISEASES miRNA-disease associations."""
	
	def __init__(self):
		self._data: Dict[str, List[Dict[str, Any]]] = {}
		self._loaded = False
	
	def load(self, filepath: str) -> None:
		"""Load JensenLab DISEASES data from TSV file."""
		if self._loaded:
			return
		
		if not os.path.exists(filepath):
			sys.stderr.write(f"[biomarker_validation] JensenLab data file not found: {filepath}\n")
			self._loaded = True
			return
		
		try:
			with open(filepath, 'r', encoding='utf-8') as f:
				for line in f:
					parts = line.strip().split('\t')
					if len(parts) < 7:
						continue
					
					entity_id = parts[0].strip()
					entity_name = parts[1].strip()
					disease_id = parts[2].strip()
					disease_name = parts[3].strip()
					z_score_str = parts[4].strip()
					confidence_str = parts[5].strip()
					link = parts[6].strip()
					
					# Only load miRNA entries (exact match, preserving -3p/-5p)
					if not (entity_id.startswith('hsa-miR-') or entity_id.startswith('hsa-let-')):
						continue
					
					try:
						z_score = float(z_score_str)
					except ValueError:
						continue
					
					# Use exact entity_id as key (case-sensitive for miRNAs)
					key = entity_id
					
					if key not in self._data:
						self._data[key] = []
					
					self._data[key].append({
						'disease_id': disease_id,
						'disease_name': disease_name,
						'z_score': z_score,
						'link': link,
					})
			
			self._loaded = True
			sys.stderr.write(f"[biomarker_validation] Loaded JensenLab DISEASES: {len(self._data)} miRNAs\n")
			
		except Exception as exc:
			sys.stderr.write(f"[biomarker_validation] Failed to load JensenLab data: {exc}\n")
			self._loaded = True
	
	def query(self, mirna_id: str, max_results: int = 10) -> List[Dict[str, Any]]:
		"""
		Query JensenLab DISEASES for disease associations for a given miRNA.
		Uses EXACT matching - no suffix stripping.
		Returns list of disease associations with normalized scores (0-1).
		"""
		if not self._loaded:
			self.load(JENSENLAB_DATA_FILE)
		
		# Exact match lookup (case-sensitive)
		results = self._data.get(mirna_id, [])
		
		if not results:
			# Try case-insensitive lookup as fallback
			mirna_lower = mirna_id.lower()
			for key in self._data:
				if key.lower() == mirna_lower:
					results = self._data[key]
					break
		
		# Sort by z_score and take top results
		sorted_results = sorted(results, key=lambda x: x['z_score'], reverse=True)[:max_results]
		
		# Normalize z-scores to 0-1 range (JensenLab z-scores typically range 0-10)
		for result in sorted_results:
			normalized = result['z_score'] / JENSENLAB_MAX_ZSCORE
			result['normalized_score'] = round(min(normalized, 1.0), 2)
		
		return sorted_results


# Global JensenLab database instance
_jensenlab_db = JensenLabDatabase()


def _read_payload() -> Dict[str, Any]:
	raw = sys.stdin.read().strip()
	if not raw:
		raise ValueError("Input payload missing.")
	try:
		result = json.loads(raw)
		if not isinstance(result, dict):
			raise ValueError("Input payload must be a JSON object.")
		return result
	except json.JSONDecodeError as exc:  # pragma: no cover - defensive
		raise ValueError("Input payload must be valid JSON.") from exc


def _unique_symbols(raw_genes: List[Any]) -> List[str]:
	"""
	Return input genes with original casing preserved while de-duplicating case-insensitively.
	This lets us show the exact gene text the user provided in the results table.
	"""
	seen = set()
	ordered: List[str] = []
	for gene in raw_genes:
		if not isinstance(gene, str):
			continue
		original = gene.strip()
		if not original:
			continue
		dedupe_key = original.upper()
		if dedupe_key in seen:
			continue
		seen.add(dedupe_key)
		ordered.append(original)
	return ordered


def _sanitize_max_genes(value: Any) -> int:
	try:
		parsed = int(value)
	except (TypeError, ValueError):
		return DEFAULT_MAX_GENES
	if parsed < 1:
		return DEFAULT_MAX_GENES
	return min(parsed, ABSOLUTE_MAX_GENES)


def _is_mature_mirna(symbol: str) -> bool:
	"""Check if the symbol is a mature microRNA (ends with -5p or -3p)."""
	return bool(MATURE_MIRNA_PATTERN.match(symbol))


def _classify_biomarker(symbol: str) -> Tuple[str, str]:
	"""
	Classify a biomarker symbol into its type.
	Returns (type, normalized_symbol).
	- Mature miRNAs (hsa-miR-132-3p) ? "microRNA" ? JensenLab DISEASES
	- miRNA genes (hsa-miR-132, MIR132) ? "Gene" ? Open Targets
	"""
	if _is_mature_mirna(symbol):
		return ("microRNA", symbol)
	elif symbol.startswith("cg") and len(symbol) > 2 and symbol[2:].isdigit():
		return ("DNA Methylation", symbol)
	else:
		return ("Gene", symbol)


def _fetch_gene(symbol: str) -> Optional[Dict[str, Any]]:
	params = {
		"q": symbol,
		"species": "human",
		"size": 1,
		"fields": "symbol,name,ensembl.gene",
	}
	response = requests.get(MYGENE_ENDPOINT, params=params, timeout=12)
	response.raise_for_status()
	payload = response.json()
	if not payload or not isinstance(payload, dict):
		return None
	hits = payload.get("hits")
	if isinstance(hits, list) and hits:
		return hits[0]
	return None


def _fetch_open_targets_rows(ensembl_id: str, size: int = 10) -> List[Dict[str, Any]]:
	if not ensembl_id:
		return []
	payload = {
		"query": OPEN_TARGETS_QUERY,
		"variables": {"ensemblId": ensembl_id, "size": size},
	}
	response = requests.post(OPEN_TARGETS_ENDPOINT, json=payload, timeout=15)
	response.raise_for_status()
	data = response.json()
	if not data or not isinstance(data, dict):
		return []
	if "errors" in data:
		raise ValueError(data["errors"][0].get("message", "Open Targets error"))
	# Use 'or {}' to handle cases where keys exist but values are None
	data_obj = data.get("data") or {}
	target_obj = data_obj.get("target") or {}
	diseases_obj = target_obj.get("associatedDiseases") or {}
	return diseases_obj.get("rows") or []


def _get_mirbase_link(mirna_id: str) -> str:
	"""Generate a miRBase link for the microRNA as fallback."""
	return f"{MIRBASE_SEARCH_URL}{mirna_id}"


def _get_jensenlab_link(mirna_id: str) -> str:
	"""Generate a JensenLab DISEASES entity page link for the microRNA."""
	return f"https://diseases.jensenlab.org/Entity?order=textmining,knowledge,experiments&textmining=10&knowledge=10&experiments=10&type1=9606&type2=-26&id1={mirna_id}"


def _get_ewas_atlas_link(probe_id: str) -> str:
	"""Generate an EWAS Atlas link for the CpG probe."""
	return f"{EWAS_ATLAS_BROWSE_URL}{probe_id}"


def _normalize_trait_name(trait: str) -> Tuple[str, str]:
	"""
	Normalize EWAS Atlas trait names to group similar diseases.
	Returns (normalized_key, display_name).
	"""
	if not trait:
		return ("unknown", "Unknown")
	
	original = trait.strip()
	
	# Lowercase for comparison
	normalized = original.lower()
	
	# Remove parenthetical abbreviations like (AD), (BMI), (PD), (WC), etc.
	normalized = re.sub(r'\s*\([^)]{1,10}\)\s*$', '', normalized)
	
	# Normalize special characters (curly quotes, backticks, acute accents to straight apostrophe)
	normalized = normalized.replace("\u2019", "'").replace("\u2018", "'")  # Right/left single quotes
	normalized = normalized.replace("`", "'").replace("\u00b4", "'")  # Backtick and acute accent
	
	# Remove trailing/leading whitespace
	normalized = normalized.strip()
	
	# Common disease name mappings (without apostrophes for cleaner display)
	disease_mappings = {
		"alzheimer's disease": "Alzheimer disease",
		"alzheimer disease": "Alzheimer disease",
		"alzheimers disease": "Alzheimer disease",
		"parkinson's disease": "Parkinson disease",
		"parkinson disease": "Parkinson disease",
		"parkinsons disease": "Parkinson disease",
		"huntington's disease": "Huntington disease",
		"huntington disease": "Huntington disease",
		"huntingtons disease": "Huntington disease",
		"crohn's disease": "Crohn disease",
		"crohn disease": "Crohn disease",
		"crohns disease": "Crohn disease",
		"type 2 diabetes": "Type 2 diabetes",
		"type 2 diabetes mellitus": "Type 2 diabetes",
		"t2d": "Type 2 diabetes",
		"type 1 diabetes": "Type 1 diabetes",
		"type 1 diabetes mellitus": "Type 1 diabetes",
		"t1d": "Type 1 diabetes",
		"body mass index": "Body mass index",
		"bmi": "Body mass index",
		"breast cancer": "Breast cancer",
		"breast carcinoma": "Breast cancer",
		"lung cancer": "Lung cancer",
		"lung carcinoma": "Lung cancer",
		"colorectal cancer": "Colorectal cancer",
		"colon cancer": "Colorectal cancer",
		"mild cognitive impairment": "Mild cognitive impairment",
		"mci": "Mild cognitive impairment",
		"rheumatoid arthritis": "Rheumatoid arthritis",
		"ra": "Rheumatoid arthritis",
		"systemic lupus erythematosus": "Systemic lupus erythematosus",
		"sle": "Systemic lupus erythematosus",
		"lupus": "Systemic lupus erythematosus",
		"major depressive disorder": "Major depressive disorder",
		"depression": "Major depressive disorder",
		"mdd": "Major depressive disorder",
		"schizophrenia": "Schizophrenia",
		"scz": "Schizophrenia",
		"aging": "Aging",
		"age": "Aging",
		"ageing": "Aging",
		"smoking": "Smoking",
		"cigarette smoking": "Smoking",
		"tobacco smoking": "Smoking",
		"alcohol consumption": "Alcohol consumption",
		"alcohol": "Alcohol consumption",
	}
	
	# Check for exact match in mappings
	if normalized in disease_mappings:
		display = disease_mappings[normalized]
		return (display.lower().replace("'", ""), display)
	
	# Remove apostrophes from display name
	display_name = original.replace("'", "") if original[0].isupper() else normalized.title().replace("'", "")
	return (normalized.replace("'", ""), display_name)


def _fetch_ewas_atlas(probe_id: str) -> Optional[Dict[str, Any]]:
	"""
	Fetch DNA methylation probe information from EWAS Atlas API.
	Returns probe data including trait/disease associations.
	"""
	try:
		response = requests.get(
			EWAS_ATLAS_API,
			params={"probeId": probe_id},
			timeout=15
		)
		response.raise_for_status()
		data = response.json()
		
		if data.get("code") == 0 and data.get("data"):
			return data["data"]
		return None
	except (requests.RequestException, ValueError, json.JSONDecodeError) as exc:
		sys.stderr.write(f"[biomarker_validation] EWAS Atlas lookup failed for {probe_id}: {exc}\n")
		return None


def _build_methylation_table_rows(input_symbol: str) -> List[Dict[str, Any]]:
	"""
	Build table rows for DNA methylation biomarkers using EWAS Atlas.
	Fetches trait/disease associations for CpG probes.
	"""
	rows: List[Dict[str, Any]] = []
	probe_id = input_symbol
	
	# Fetch from EWAS Atlas API
	ewas_data = _fetch_ewas_atlas(probe_id)
	ewas_link = _get_ewas_atlas_link(probe_id)
	
	if ewas_data and ewas_data.get("associationList"):
		associations = ewas_data["associationList"]
		
		# Get related gene if available
		related_genes = ewas_data.get("relatedTranscription") or []
		first_gene = related_genes[0] if isinstance(related_genes, list) and related_genes else None
		gene_name = first_gene.get("geneName", "") if isinstance(first_gene, dict) else ""
		probe_name = f"{probe_id} ({gene_name})" if gene_name else probe_id
		
		# Group by NORMALIZED trait: count studies and track best rank for each
		# This groups variations like "Alzheimer's Disease" and "Alzheimer's disease (AD)"
		trait_data: Dict[str, Dict[str, Any]] = {}
		for assoc in associations:
			raw_trait = assoc.get("trait", "Unknown")
			norm_key, display_name = _normalize_trait_name(raw_trait)
			rank = assoc.get("rank")
			# Skip if rank is None or not a number
			if rank is None or not isinstance(rank, (int, float)):
				rank = 99999
			
			if norm_key not in trait_data:
				trait_data[norm_key] = {"display_name": display_name, "count": 0, "best_rank": rank}
			
			trait_data[norm_key]["count"] += 1
			if rank < trait_data[norm_key]["best_rank"]:
				trait_data[norm_key]["best_rank"] = rank
		
		# Calculate score based on study count and best rank
		# More studies and better ranks = higher score
		import math
		scored_traits = []
		for norm_key, data in trait_data.items():
			display_name = data["display_name"]
			count = data["count"]
			best_rank = data["best_rank"]
			
			# Base score from study count (max ~0.5 for many studies)
			# 1 study = 0.1, 2 = 0.18, 5 = 0.35, 10 = 0.5
			count_score = min(0.5, 0.1 * math.log2(count + 1))
			
			# Rank bonus (max ~0.5 for rank 1)
			# Rank 1 = 0.5, rank 10 = 0.25, rank 100 = 0.17, rank 1000 = 0.125
			rank_score = 0.5 / (1 + math.log10(max(best_rank, 1)))
			
			total_score = round(count_score + rank_score, 2)
			scored_traits.append((display_name, total_score, count, best_rank))
		
		# Sort by score (higher is better) and take top 10
		sorted_traits = sorted(scored_traits, key=lambda x: x[1], reverse=True)[:10]
		
		for display_name, score, count, best_rank in sorted_traits:
			rows.append({
				"biomarkerSymbol": probe_id,
				"biomarkerType": "DNA Methylation",
				"biomarkerName": probe_name,
				"disease": display_name,
				"score": score,
				"source": "EWAS Atlas",
				"link": ewas_link,
			})
	else:
		# No EWAS Atlas data - add a fallback row
		rows.append({
			"biomarkerSymbol": probe_id,
			"biomarkerType": "DNA Methylation",
			"biomarkerName": probe_id,
			"disease": "No associations found in EWAS Atlas",
			"score": None,
			"source": "EWAS Atlas",
			"link": ewas_link,
		})
	
	return rows


def _build_table_rows(
	input_symbol: str,
	hit: Dict[str, Any],
	associations: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
	# Show the gene exactly as provided by the user; keep API-resolved name separately.
	gene_symbol = input_symbol
	gene_name = hit.get("name") or ""
	ensembl = hit.get("ensembl") or {}
	if isinstance(ensembl, list) and ensembl:
		ensembl = ensembl[0]

	if isinstance(ensembl, dict):
		ensembl_id = ensembl.get("gene")
		if isinstance(ensembl_id, list) and ensembl_id:
			ensembl_id = ensembl_id[0]
	else:
		ensembl_id = None
	rows: List[Dict[str, Any]] = []
	for assoc in associations:
		if not isinstance(assoc, dict):
			continue
		disease = assoc.get("disease") or {}
		disease_name = disease.get("name")
		if not disease_name:
			continue
		rows.append({
			"biomarkerSymbol": gene_symbol,
			"biomarkerType": "Gene",
			"biomarkerName": gene_name,
			"disease": disease_name,
			"score": assoc.get("score"),
			"source": "Open Targets",
			"link": (
				f"https://platform.opentargets.org/target/{ensembl_id}/associations"
				if ensembl_id
				else ""
			),
		})
	return rows


def _build_mirna_table_rows(input_symbol: str) -> List[Dict[str, Any]]:
	"""
	Build table rows for microRNA biomarkers using JensenLab DISEASES database.
	Performs EXACT matching on the full miRNA ID (including -5p/-3p suffix).
	Falls back to miRBase link if no JensenLab matches found.
	"""
	rows: List[Dict[str, Any]] = []
	mirna_id = input_symbol
	
	# Query JensenLab DISEASES for exact matches
	associations = _jensenlab_db.query(mirna_id)
	
	if associations:
		# Create a row for each disease association
		# Use single JensenLab entity page link for all associations
		jensenlab_link = _get_jensenlab_link(mirna_id)
		
		for assoc in associations:
			# Use pre-computed normalized score (0-1 range)
			normalized_score = assoc.get("normalized_score", 0)
			
			rows.append({
				"biomarkerSymbol": mirna_id,
				"biomarkerType": "microRNA",
				"biomarkerName": mirna_id,
				"disease": assoc.get("disease_name", "Unknown"),
				"score": normalized_score,
				"source": "JensenLab DISEASES",
				"link": jensenlab_link,
			})
	else:
		# No JensenLab matches - add a single row with miRBase link for investigation
		rows.append({
			"biomarkerSymbol": mirna_id,
			"biomarkerType": "microRNA",
			"biomarkerName": mirna_id,
			"disease": "No disease associations found - see miRBase for sequence info",
			"score": None,
			"source": "miRBase (fallback)",
			"link": _get_mirbase_link(mirna_id),
		})
	
	return rows


def _build_response_rows(genes: List[str]) -> Dict[str, Any]:
	table_rows: List[Dict[str, Any]] = []
	unmatched: List[str] = []
	mirna_count = 0
	gene_count = 0
	methylation_count = 0

	for symbol in genes:
		rows: List[Dict[str, Any]] = []
		biomarker_type, _ = _classify_biomarker(symbol)
		
		try:
			if biomarker_type == "microRNA":
				# Handle microRNAs with JensenLab DISEASES (exact matching)
				rows = _build_mirna_table_rows(symbol)
				if rows:
					mirna_count += 1
			elif biomarker_type == "DNA Methylation":
				# Handle DNA methylation probes with EWAS Atlas
				rows = _build_methylation_table_rows(symbol)
				if rows:
					methylation_count += 1
			else:
				# Handle genes and miRNA genes with Open Targets
				hit = _fetch_gene(symbol)
				if hit:
					ensembl = hit.get("ensembl") or {}
					if isinstance(ensembl, list) and ensembl:
						ensembl = ensembl[0]

					if isinstance(ensembl, dict):
						ensembl_id = ensembl.get("gene")
						if isinstance(ensembl_id, list) and ensembl_id:
							ensembl_id = ensembl_id[0]
					else:
						ensembl_id = None
					associations = _fetch_open_targets_rows(ensembl_id) if ensembl_id else []
					rows = _build_table_rows(symbol, hit, associations)
					if rows:
						gene_count += 1
		except (requests.RequestException, ValueError) as exc:
			rows = []
			sys.stderr.write(f"[biomarker_validation] Lookup failed for {symbol}: {exc}\n")

		if not rows:
			unmatched.append(symbol)
		else:
			table_rows.extend(rows)

	return {
		"tableRows": table_rows,
		"unmatched": unmatched,
		"mirnaCount": mirna_count,
		"geneCount": gene_count,
		"methylationCount": methylation_count,
	}


def main() -> None:
	payload = _read_payload()
	raw_genes = payload.get("genes")
	if not isinstance(raw_genes, list) or not raw_genes:
		raise ValueError("Please provide a non-empty list of biomarker symbols.")
	symbols = _unique_symbols(raw_genes)
	max_genes = _sanitize_max_genes(payload.get("maxGenes"))
	limited_symbols = symbols[:max_genes]

	result = _build_response_rows(limited_symbols)

	response = {
		"success": True,
		"timestamp": datetime.utcnow().isoformat() + "Z",
		"biomarkerCount": len(limited_symbols),
		"geneCount": result.get("geneCount", 0),
		"mirnaCount": result.get("mirnaCount", 0),
		"methylationCount": result.get("methylationCount", 0),
		"maxGenes": max_genes,
		"table": {
			"columns": TABLE_COLUMNS,
			"rows": result["tableRows"],
			"rowCount": len(result["tableRows"]),
		},
		"unmatchedBiomarkers": result["unmatched"],
		# Keep legacy field for backward compatibility
		"unmatchedGenes": result["unmatched"],
	}
	print(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
	try:
		main()
	except Exception as exc:  # pylint: disable=broad-except
		error_payload = {"success": False, "message": str(exc)}
		print(json.dumps(error_payload, ensure_ascii=False))
		sys.exit(1)

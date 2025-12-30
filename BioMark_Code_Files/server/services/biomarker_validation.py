"""Biomarker validation service that outputs gene-disease and microRNA-disease matches."""

from __future__ import annotations

import csv
import json
import os
import re
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

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
		return json.loads(raw)
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
	if "errors" in data:
		raise ValueError(data["errors"][0].get("message", "Open Targets error"))
	return (
		data.get("data", {})
		.get("target", {})
		.get("associatedDiseases", {})
		.get("rows", [])
	)


def _get_mirbase_link(mirna_id: str) -> str:
	"""Generate a miRBase link for the microRNA as fallback."""
	return f"{MIRBASE_SEARCH_URL}{mirna_id}"


def _get_jensenlab_link(mirna_id: str) -> str:
	"""Generate a JensenLab DISEASES entity page link for the microRNA."""
	return f"https://diseases.jensenlab.org/Entity?order=textmining,knowledge,experiments&textmining=10&knowledge=10&experiments=10&type1=9606&type2=-26&id1={mirna_id}"


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
				# DNA methylation probes - mark as unmatched for now
				# Could add EWAS/methylation databases in the future
				rows = []
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

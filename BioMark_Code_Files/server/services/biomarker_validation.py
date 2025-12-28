"""Minimal biomarker validation service that outputs gene-disease matches only."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

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
DEFAULT_MAX_GENES = 10
ABSOLUTE_MAX_GENES = 100

TABLE_COLUMNS = [
	{"key": "geneSymbol", "label": "Gene"},
	{"key": "geneName", "label": "Gene Name"},
	{"key": "disease", "label": "Disease / Condition"},
	{"key": "score", "label": "Association Score"},
	{"key": "link", "label": "Link"},
]


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


def _is_mirna(symbol: str) -> bool:
	"""Check if symbol matches miRNA pattern (e.g., hsa-miR-22-3p, mmu-miR-100)."""
	return bool(re.match(r"^[a-z]+-miR-\d+", symbol, re.IGNORECASE))


def _strip_mirna_suffix(symbol: str) -> str:
	"""Strip arm suffix from miRNA (e.g., hsa-miR-22-3p -> hsa-miR-22, hsa-miR-181b-5p -> hsa-miR-181b)."""
	# Remove -3p or -5p or -3p/5p variants at the end
	return re.sub(r"-(3p|5p|3p/5p)$", "", symbol, flags=re.IGNORECASE)


def _fetch_gene(symbol: str) -> Optional[Dict[str, Any]]:
	"""Fetch gene data from MyGene."""
	query_symbol = symbol
	is_mirna = _is_mirna(symbol)
	if is_mirna:
		query_symbol = _strip_mirna_suffix(symbol)
		sys.stderr.write(f"[MyGene API] Detected miRNA, stripping suffix: {symbol} -> {query_symbol}\n")
	
	# Try MyGene
	params = {
		"q": query_symbol,
		"species": "human",
		"size": 1,
		"fields": "symbol,name,ensembl.gene",
	}
	sys.stderr.write(f"[MyGene API] Sending request with params: {json.dumps(params, ensure_ascii=False)}\n")
	try:
		response = requests.get(MYGENE_ENDPOINT, params=params, timeout=12)
		response.raise_for_status()
		payload = response.json()
		sys.stderr.write(f"[MyGene API] Response received: {json.dumps(payload, ensure_ascii=False)}\n")
		hits = payload.get("hits")
		if isinstance(hits, list) and hits:
			return hits[0]
	except Exception as exc:
		sys.stderr.write(f"[MyGene API] Error: {exc}\n")
	
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


def _build_table_rows(
	input_symbol: str,
	hit: Dict[str, Any],
	associations: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
	# Show the gene exactly as provided by the user; keep API-resolved name separately.
	gene_symbol = input_symbol
	gene_name = hit.get("name") or ""
	ensembl = hit.get("ensembl")
	if isinstance(ensembl, dict):
		ensembl_id = ensembl.get("gene")
	elif isinstance(ensembl, list) and ensembl:
		# Take first element if ensembl is a list
		ensembl_id = ensembl[0].get("gene") if isinstance(ensembl[0], dict) else None
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
			"geneSymbol": gene_symbol,
			"geneName": gene_name,
			"disease": disease_name,
			"score": assoc.get("score"),
			"link": (
				f"https://platform.opentargets.org/target/{ensembl_id}/associations"
				if ensembl_id
				else ""
			),
		})
	return rows


def _build_response_rows(genes: List[str]) -> Dict[str, Any]:
	table_rows: List[Dict[str, Any]] = []
	unmatched: List[str] = []

	for symbol in genes:
		rows: List[Dict[str, Any]] = []
		try:
			# Gene/miRNA pipeline: MyGene -> Open Targets
			hit = _fetch_gene(symbol)
			if hit:
				ensembl = hit.get("ensembl")
				if isinstance(ensembl, dict):
					ensembl_id = ensembl.get("gene")
				elif isinstance(ensembl, list) and ensembl:
					# Take first element if ensembl is a list
					ensembl_id = ensembl[0].get("gene") if isinstance(ensembl[0], dict) else None
				else:
					ensembl_id = None
				associations = _fetch_open_targets_rows(ensembl_id) if ensembl_id else []
				# If Open Targets returns no associations but we have an Ensembl ID, add a "no results" row
				if ensembl_id and not associations:
					gene_name = hit.get("name") or ""
					rows = [{
						"geneSymbol": symbol,
						"geneName": gene_name,
						"disease": "No associated diseases found",
						"score": None,
						"link": f"https://platform.opentargets.org/target/{ensembl_id}/associations",
					}]
				else:
					rows = _build_table_rows(symbol, hit, associations)
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
	}


def main() -> None:
	payload = _read_payload()
	raw_genes = payload.get("genes")
	if not isinstance(raw_genes, list) or not raw_genes:
		raise ValueError("Please provide a non-empty list of gene symbols.")
	symbols = _unique_symbols(raw_genes)
	max_genes = _sanitize_max_genes(payload.get("maxGenes"))
	limited_symbols = symbols[:max_genes]

	result = _build_response_rows(limited_symbols)

	response = {
		"success": True,
		"timestamp": datetime.utcnow().isoformat() + "Z",
		"geneCount": len(limited_symbols),
		"maxGenes": max_genes,
		"table": {
			"columns": TABLE_COLUMNS,
			"rows": result["tableRows"],
			"rowCount": len(result["tableRows"]),
		},
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

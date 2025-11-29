"""Minimal biomarker validation service that outputs gene-disease matches only."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
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
CACHE_TTL_SECONDS = 60 * 60 * 6  # 6 hours
CACHE_PATH = Path(__file__).resolve().parent.parent / "artifacts" / "validation_table_cache.json"
CACHE_VERSION = 2

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
	seen = set()
	ordered: List[str] = []
	for gene in raw_genes:
		if not isinstance(gene, str):
			continue
		symbol = gene.strip().upper()
		if not symbol or symbol in seen:
			continue
		seen.add(symbol)
		ordered.append(symbol)
	return ordered


def _sanitize_max_genes(value: Any) -> int:
	try:
		parsed = int(value)
	except (TypeError, ValueError):
		return DEFAULT_MAX_GENES
	if parsed < 1:
		return DEFAULT_MAX_GENES
	return min(parsed, ABSOLUTE_MAX_GENES)


def _load_cache() -> Dict[str, Dict[str, Any]]:
	if not CACHE_PATH.exists():
		return {}
	try:
		with CACHE_PATH.open("r", encoding="utf-8") as handle:
			raw_cache = json.load(handle)
	except (OSError, json.JSONDecodeError):  # pragma: no cover - defensive
		return {}
	now = time.time()
	return {
		gene: entry
		for gene, entry in raw_cache.items()
		if (
			isinstance(entry, dict)
			and entry.get("expiry", 0) > now
			and entry.get("version") == CACHE_VERSION
			and "rows" in entry
		)
	}


def _persist_cache(cache: Dict[str, Dict[str, Any]]) -> None:
	try:
		CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
		temp = CACHE_PATH.with_suffix(".tmp")
		with temp.open("w", encoding="utf-8") as handle:
			json.dump(cache, handle)
		temp.replace(CACHE_PATH)
	except OSError:
		pass  # Cache failures should not block the response


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


def _build_table_rows(
	symbol: str,
	hit: Dict[str, Any],
	associations: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
	gene_symbol = hit.get("symbol") or symbol
	gene_name = hit.get("name") or ""
	ensembl = hit.get("ensembl") or {}
	if isinstance(ensembl, dict):
		ensembl_id = ensembl.get("gene")
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
	cache = _load_cache()
	now = time.time()
	table_rows: List[Dict[str, Any]] = []
	unmatched: List[str] = []
	cache_changed = False

	for symbol in genes:
		cached = cache.get(symbol)
		if cached:
			table_rows.extend(cached["rows"])
			continue

		rows: List[Dict[str, Any]] = []
		try:
			hit = _fetch_gene(symbol)
			if hit:
				ensembl = hit.get("ensembl") or {}
				if isinstance(ensembl, dict):
					ensembl_id = ensembl.get("gene")
				else:
					ensembl_id = None
				associations = _fetch_open_targets_rows(ensembl_id) if ensembl_id else []
				rows = _build_table_rows(symbol, hit, associations)
		except (requests.RequestException, ValueError) as exc:
			rows = [{
				"geneSymbol": symbol,
				"geneName": "",
				"disease": "Lookup failed",
				"score": None,
				"link": "",
			}]

		if not rows:
			unmatched.append(symbol)
		else:
			table_rows.extend(rows)

		cache[symbol] = {
			"rows": rows,
			"expiry": now + CACHE_TTL_SECONDS,
			"version": CACHE_VERSION,
		}
		cache_changed = True

	if cache_changed:
		_persist_cache(cache)

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

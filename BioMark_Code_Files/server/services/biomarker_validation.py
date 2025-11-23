import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

MY_GENE_ENDPOINT = "https://mygene.info/v3/query"
MAX_ITEMS_PER_SOURCE = 3
DEFAULT_MAX_GENES_PER_VALIDATION = 10
ABSOLUTE_MAX_GENES_PER_VALIDATION = 100
CACHE_TTL_SECONDS = 60 * 60 * 6  # 6 hours
CACHE_PATH = Path(__file__).resolve().parent.parent / "artifacts" / "biomarker_validation_cache.json"


def read_payload() -> Dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError("Missing input payload.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Input payload must be valid JSON.") from exc


def unique_uppercase_symbols(raw_genes: List[Any]) -> List[str]:
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


def load_cache() -> Dict[str, Dict[str, Any]]:
    if not CACHE_PATH.exists():
        return {}
    try:
        with CACHE_PATH.open("r", encoding="utf-8") as handle:
            raw_cache = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}

    now = time.time()
    filtered: Dict[str, Dict[str, Any]] = {}
    for gene, entry in raw_cache.items():
        expiry = entry.get("expiry", 0)
        if expiry > now and "value" in entry:
            filtered[gene] = entry
    return filtered


def persist_cache(cache: Dict[str, Dict[str, Any]]) -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temp_path = CACHE_PATH.with_suffix(".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(cache, handle)
        temp_path.replace(CACHE_PATH)
    except OSError:
        # Cache persistence failure should not block the response
        pass


def fetch_gene_hit(symbol: str) -> Optional[Dict[str, Any]]:
    params = {
        "q": f"symbol:{symbol}",
        "species": "human",
        "size": 1,
        "fields": "symbol,name,summary,disgenet,hpa,generif,ensembl"
    }
    response = requests.get(MY_GENE_ENDPOINT, params=params, timeout=12)
    response.raise_for_status()
    payload = response.json()
    hits = payload.get("hits")
    if isinstance(hits, list) and hits:
        return hits[0]
    return None


def extract_ensembl_id(hit: Dict[str, Any]) -> Optional[str]:
    ensembl = hit.get("ensembl")
    if isinstance(ensembl, list):
        for entry in ensembl:
            gene_id = entry.get("gene") if isinstance(entry, dict) else None
            if gene_id:
                return gene_id
    elif isinstance(ensembl, dict):
        return ensembl.get("gene")
    return None


def build_disgenet_source(hit: Dict[str, Any], fallback_gene: str) -> Optional[Dict[str, Any]]:
    disgenet = hit.get("disgenet")
    if not disgenet:
        return None
    entries = disgenet if isinstance(disgenet, list) else [disgenet]
    prepared = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        disease_name = entry.get("disease_name") or entry.get("diseaseid") or entry.get("disease_id")
        if not disease_name:
            continue
        pubmed_ids = entry.get("pubmed")
        if isinstance(pubmed_ids, list):
            pubmed_trimmed = pubmed_ids[:3]
        elif pubmed_ids:
            pubmed_trimmed = [pubmed_ids]
        else:
            pubmed_trimmed = []
        disease_id = entry.get("diseaseid") or entry.get("disease_id")
        prepared.append({
            "label": disease_name,
            "score": entry.get("score"),
            "evidence": pubmed_trimmed,
            "snippet": entry.get("snippet"),
            "url": f"https://www.disgenet.org/disease/{disease_id}" if disease_id else f"https://www.disgenet.org/search?query={fallback_gene}"
        })
    prepared.sort(key=lambda item: item.get("score") or 0, reverse=True)
    prepared = prepared[:MAX_ITEMS_PER_SOURCE]
    if not prepared:
        return None
    return {
        "source": "DisGeNET",
        "kind": "disease-association",
        "items": prepared
    }


def build_hpa_source(hit: Dict[str, Any], gene_symbol: str) -> Optional[Dict[str, Any]]:
    hpa = hit.get("hpa")
    if not isinstance(hpa, dict):
        return None
    entries: List[Dict[str, Optional[str]]] = []
    subcellular = hpa.get("subcellular_location")
    if isinstance(subcellular, list):
        for loc in subcellular:
            if isinstance(loc, dict):
                entries.append({
                    "label": loc.get("location") or str(loc),
                    "detail": loc.get("reliability") or hpa.get("reliability")
                })
            else:
                entries.append({"label": str(loc), "detail": hpa.get("reliability")})
    tissue_expression = hpa.get("tissue_specific_expression")
    if isinstance(tissue_expression, list):
        for tissue in tissue_expression:
            if isinstance(tissue, dict):
                entries.append({
                    "label": tissue.get("tissue") or tissue.get("name") or str(tissue),
                    "detail": tissue.get("level") or tissue.get("value")
                })
            else:
                entries.append({"label": str(tissue), "detail": None})
    rna_category = hpa.get("rna_tissue_category")
    if rna_category:
        entries.insert(0, {"label": "RNA tissue category", "detail": rna_category})
    prepared = [
        {"label": entry.get("label") or "Protein expression", "detail": entry.get("detail") or "Reported"}
        for entry in entries[:MAX_ITEMS_PER_SOURCE]
    ]
    if not prepared:
        return None
    return {
        "source": "Human Protein Atlas",
        "kind": "expression",
        "items": prepared,
        "link": f"https://www.proteinatlas.org/{gene_symbol}"
    }


def build_generif_source(hit: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    generif = hit.get("generif")
    if not isinstance(generif, list) or not generif:
        return None
    prepared = []
    for entry in generif[:MAX_ITEMS_PER_SOURCE]:
        if not isinstance(entry, dict):
            continue
        item = {
            "label": entry.get("text") or "Literature reference",
            "pubmed": entry.get("pubmed"),
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{entry.get('pubmed')}/" if entry.get("pubmed") else None
        }
        prepared.append(item)
    if not prepared:
        return None
    return {
        "source": "NCBI GeneRIF",
        "kind": "literature",
        "items": prepared
    }


def build_cross_reference_links(symbol: str, ensembl_id: Optional[str]) -> List[Dict[str, Any]]:
    safe_symbol = symbol or "GENE"
    links = [
        {
            "source": "GeneCards",
            "kind": "link",
            "items": [{"label": "View GeneCards profile", "url": f"https://www.genecards.org/cgi-bin/carddisp.pl?gene={safe_symbol}"}]
        },
        {
            "source": "TCGA / GDC",
            "kind": "link",
            "items": [{"label": "Open GDC gene overview", "url": f"https://portal.gdc.cancer.gov/genes/{safe_symbol}"}]
        },
        {
            "source": "Open Targets",
            "kind": "link",
            "items": [{
                "label": "Inspect target on Open Targets",
                "url": f"https://platform.opentargets.org/target/{ensembl_id}" if ensembl_id else f"https://platform.opentargets.org/search?query={safe_symbol}"
            }]
        },
        {
            "source": "DisGeNET",
            "kind": "link",
            "items": [{"label": "Search DisGeNET", "url": f"https://www.disgenet.org/search?query={safe_symbol}"}]
        },
        {
            "source": "Human Protein Atlas",
            "kind": "link",
            "items": [{"label": "Protein Atlas overview", "url": f"https://www.proteinatlas.org/{safe_symbol}"}]
        }
    ]
    return links


def sanitize_max_genes(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return DEFAULT_MAX_GENES_PER_VALIDATION
    if parsed < 1:
        return DEFAULT_MAX_GENES_PER_VALIDATION
    return min(parsed, ABSOLUTE_MAX_GENES_PER_VALIDATION)


def validate_genes(raw_genes: List[Any], requested_max_genes: Any) -> Dict[str, Any]:
    if not isinstance(raw_genes, list) or not raw_genes:
        raise ValueError("Please provide at least one gene symbol.")

    gene_symbols = unique_uppercase_symbols(raw_genes)
    effective_max = sanitize_max_genes(requested_max_genes)
    limited_genes = gene_symbols[:effective_max]
    cache = load_cache()
    now = time.time()

    results: List[Dict[str, Any]] = []
    cache_changed = False

    for symbol in limited_genes:
        cached_entry = cache.get(symbol)
        if cached_entry:
            results.append(cached_entry["value"])
            continue

        entry: Dict[str, Any] = {"gene": symbol, "sources": []}
        try:
            hit = fetch_gene_hit(symbol)
            if hit:
                entry.update({
                    "matchedSymbol": hit.get("symbol", symbol),
                    "name": hit.get("name"),
                    "summary": hit.get("summary"),
                    "entrezId": hit.get("_id"),
                    "ensemblId": extract_ensembl_id(hit),
                    "sources": []
                })
                disgenet = build_disgenet_source(hit, entry.get("matchedSymbol") or symbol)
                if disgenet:
                    entry["sources"].append(disgenet)
                hpa = build_hpa_source(hit, entry.get("matchedSymbol") or symbol)
                if hpa:
                    entry["sources"].append(hpa)
                generif = build_generif_source(hit)
                if generif:
                    entry["sources"].append(generif)
        except requests.RequestException as exc:
            entry["error"] = f"Lookup failed: {exc}"[:250]

        entry["sources"].extend(build_cross_reference_links(entry.get("matchedSymbol") or symbol, entry.get("ensemblId")))
        cache[symbol] = {"value": entry, "expiry": now + CACHE_TTL_SECONDS}
        cache_changed = True
        results.append(entry)

    if cache_changed:
        persist_cache(cache)

    return {
        "success": True,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "geneCount": len(limited_genes),
        "maxGenes": effective_max,
        "results": results
    }


def main() -> None:
    payload = read_payload()
    output = validate_genes(payload.get("genes", []), payload.get("maxGenes"))
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pylint: disable=broad-except
        error_payload = {"success": False, "message": str(exc)}
        print(json.dumps(error_payload, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

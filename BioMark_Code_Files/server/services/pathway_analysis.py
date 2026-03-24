import json
import os
import sys
import uuid
import warnings
from datetime import datetime
from typing import List

# Suppress urllib3 SSL warnings (LibreSSL compatibility)
warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")

import pandas as pd
from gseapy import enrichr


DEFAULT_GENE_SET = "KEGG_2021_Human"
DEFAULT_ORGANISM = "human"
SIGNIFICANCE_THRESHOLD = 0.05


def load_mirna_targets(service_dir: str = None) -> dict:
    """
    Load miRNA target mappings from CSV file.
    Returns a dict mapping miRNA IDs to their first target gene.
    """
    if service_dir is None:
        service_dir = os.path.dirname(__file__)
    
    mirna_file = os.path.join(service_dir, "miRNA_targets.csv")
    mirna_map = {}
    
    try:
        if os.path.exists(mirna_file):
            df = pd.read_csv(mirna_file)
            # Group by miRNA and take the first target gene for each miRNA
            for mirna, group in df.groupby("miRNA"):
                first_target = group["Target Gene"].iloc[0]
                mirna_map[mirna] = first_target
    except Exception as e:
        # If loading fails, continue without miRNA mapping
        pass
    
    return mirna_map

def map_mirnas_to_genes(features: List[str], service_dir: str = None) -> List[str]:
    """
    Check if features contain miRNAs and map them to target genes.
    Returns list of genes with miRNAs replaced by their target genes.
    """
    mirna_map = load_mirna_targets(service_dir)
    
    if not mirna_map:
        return features
    
    mapped_features = []
    for feature in features:
        if isinstance(feature, str):
            # Check if feature contains 'miR' (case-insensitive)
            if 'mir' in feature.lower():
                # Try exact match first
                if feature in mirna_map:
                    mapped_features.append(mirna_map[feature])
                else:
                    # Try to find a match that contains this feature
                    found = False
                    for mirna_id, target_gene in mirna_map.items():
                        if feature.lower() in mirna_id.lower():
                            mapped_features.append(target_gene)
                            found = True
                            break
                    if not found:
                        # If no match found, keep original feature
                        mapped_features.append(feature)
            else:
                mapped_features.append(feature)
        else:
            mapped_features.append(feature)
    
    return mapped_features

def sanitize_label_for_path(label: str) -> str:
    if not label:
        return "kegg_pathway_analysis_results"
    safe = label.strip().lower().replace(" ", "_")
    return safe or "kegg_pathway_analysis_results"


def ensure_output_directory(base_dir: str, class_pair: str, analysis_label: str) -> str:
    results_root = os.path.abspath(base_dir) if base_dir else os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "results")
    )
    output_dir = os.path.join(results_root, "pathway_analysis")
    if class_pair:
        output_dir = os.path.join(output_dir, class_pair)
    output_dir = os.path.join(output_dir, sanitize_label_for_path(analysis_label))
    os.makedirs(output_dir, exist_ok=True)
    # Do NOT clear existing contents - keep all pathway analysis results with timestamps
    return output_dir


def perform_enrichment_analysis(
    analysis_results: List[str],
    results_dir: str,
    class_pair: str = "",
    gene_set: str = DEFAULT_GENE_SET,
    analysis_label: str = "KEGG pathway analysis",
    analysis_display_name: str = "KEGG pathway analysis",
    organism: str = DEFAULT_ORGANISM,
):
    # Map miRNAs to genes if present
    service_dir = os.path.dirname(__file__)
    mapped_analysis_results = map_mirnas_to_genes(analysis_results, service_dir)
    
    try:
        sanitized = [gene.strip() for gene in mapped_analysis_results if isinstance(gene, str) and gene.strip()]
        if not sanitized:
            summary = "No significant genes found in the analysis results."
            return {
                "success": False,
                "message": summary,
                "error": "No significant genes available for analysis.",
                "data": {
                    "pathwayResults": None,
                    "summary": summary,
                    "significantPathwayCount": 0,
                    "totalPathways": 0,
                    "inputGeneCount": 0,
                    "classPair": class_pair or None,
                    "analysisLabel": analysis_label,
                    "analysisDisplayName": analysis_display_name,
                    "geneSet": gene_set,
                },
            }

        enrichment = enrichr(gene_list=sanitized, gene_sets=gene_set or DEFAULT_GENE_SET, organism=organism)
        results = getattr(enrichment, "results", pd.DataFrame())

        run_id = datetime.utcnow().strftime("%Y%m%d-%H%M%S") + f"_{uuid.uuid4().hex[:6]}"

        if results.empty:
            summary = f"No {analysis_display_name} pathways were returned for the provided genes."
            output_dir = ensure_output_directory(results_dir, class_pair, analysis_label)
            output_path = os.path.join(
                output_dir,
                f"{sanitize_label_for_path(analysis_label)}_{run_id}.csv",
            )
            results.to_csv(output_path, index=False)
            return {
                "success": True,
                "message": summary,
                "data": {
                    "pathwayResults": output_path,
                    "summary": summary,
                    "significantPathwayCount": 0,
                    "totalPathways": 0,
                    "inputGeneCount": len(sanitized),
                    "classPair": class_pair or None,
                    "runId": run_id,
                    "analysisLabel": analysis_label,
                    "analysisDisplayName": analysis_display_name,
                    "geneSet": gene_set,
                },
            }

        if "Adjusted P-value" in results.columns:
            results = results.sort_values(by="Adjusted P-value", ascending=True)
            significant_mask = results["Adjusted P-value"] < SIGNIFICANCE_THRESHOLD
            significant_pathways = results[significant_mask]
        else:
            significant_pathways = pd.DataFrame()

        output_dir = ensure_output_directory(results_dir, class_pair, analysis_label)
        output_path = os.path.join(
            output_dir,
            f"{sanitize_label_for_path(analysis_label)}_{run_id}.csv",
        )

        export_frame = significant_pathways if not significant_pathways.empty else results
        export_frame.to_csv(output_path, index=False)

        significant_count = int(significant_pathways.shape[0]) if not significant_pathways.empty else 0
        total_count = int(results.shape[0])
        summary = (
            f"{analysis_display_name} completed: {significant_count} of {total_count} pathways "
            f"passed the significance threshold ({SIGNIFICANCE_THRESHOLD})."
        )

        return {
            "success": True,
            "message": summary,
            "data": {
                "pathwayResults": output_path,
                "summary": summary,
                "significantPathwayCount": significant_count,
                "totalPathways": total_count,
                "inputGeneCount": len(sanitized),
                "classPair": class_pair or None,
                "runId": run_id,
                "analysisLabel": analysis_label,
                "analysisDisplayName": analysis_display_name,
                "geneSet": gene_set,
            },
        }
    except Exception as exc:
        summary = f"{analysis_display_name} failed due to an error."
        return {
            "success": False,
            "message": summary,
            "error": str(exc),
            "data": {
                "pathwayResults": None,
                "summary": summary,
                "significantPathwayCount": 0,
                "totalPathways": 0,
                "inputGeneCount": len(analysis_results) if analysis_results else 0,
                "classPair": class_pair or None,
                "runId": None,
                "analysisLabel": analysis_label,
                "analysisDisplayName": analysis_display_name,
                "geneSet": gene_set,
            },
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        failure_payload = {
            "success": False,
            "message": "Pathway analysis input file was not provided.",
            "error": "Usage: python pathway_analysis.py <analysis_results.json> [results_dir] [class_pair] [gene_set] [analysis_label] [analysis_display_name]",
            "data": {
                "pathwayResults": None,
                "summary": "Missing input parameters prevented execution.",
                "significantPathwayCount": 0,
                "totalPathways": 0,
                "inputGeneCount": 0,
                "classPair": None,
            },
        }
        print(json.dumps(failure_payload))
        sys.exit(1)

    gene_list_path = sys.argv[1]
    provided_results_dir = sys.argv[2] if len(sys.argv) >= 3 else os.path.join(os.path.dirname(__file__), "..", "results")
    provided_class_pair = sys.argv[3] if len(sys.argv) >= 4 else ""
    provided_gene_set = sys.argv[4] if len(sys.argv) >= 5 else DEFAULT_GENE_SET
    provided_analysis_label = sys.argv[5] if len(sys.argv) >= 6 else "KEGG pathway analysis"
    provided_analysis_display = sys.argv[6] if len(sys.argv) >= 7 else provided_analysis_label

    try:
        with open(gene_list_path, "r", encoding="utf-8") as handle:
            raw_payload = json.load(handle)

        if isinstance(raw_payload, dict):
            candidate = raw_payload.get("analysisResults") or raw_payload.get("genes")
            analysis_results = candidate if isinstance(candidate, list) else []
        elif isinstance(raw_payload, list):
            analysis_results = raw_payload
        else:
            analysis_results = []

        result = perform_enrichment_analysis(
            analysis_results,
            provided_results_dir,
            provided_class_pair,
            gene_set=provided_gene_set,
            analysis_label=provided_analysis_label,
            analysis_display_name=provided_analysis_display,
        )
        print(json.dumps(result))

        if not result.get("success", False):
            sys.exit(1)
    except Exception as exc:
        failure_payload = {
            "success": False,
            "message": f"{provided_analysis_label} failed to start.",
            "error": str(exc),
            "data": {
                "pathwayResults": None,
                "summary": "Unable to load or parse the input genes.",
                "significantPathwayCount": 0,
                "totalPathways": 0,
                "inputGeneCount": 0,
                "classPair": provided_class_pair or None,
                "analysisLabel": provided_analysis_label,
                "analysisDisplayName": provided_analysis_display,
                "geneSet": provided_gene_set,
            },
        }
        print(json.dumps(failure_payload))
        sys.exit(1)
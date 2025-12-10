import matplotlib
# Ensure headless rendering on servers without a display
matplotlib.use("Agg")
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import sys
import os
import re

# Get parameters from command line
data_path = sys.argv[1]  # File path
feature_count = int(sys.argv[2]) if len(sys.argv) > 2 else 20  # Number of miRNAs to display

# Optional class pair, csv path, and aggregation label parameters
class_pair = sys.argv[3] if len(sys.argv) > 3 else None  # Class pair (optional)
csv_path = sys.argv[4] if len(sys.argv) > 4 else None  # CSV file path (optional)
agg_label = sys.argv[5] if len(sys.argv) > 5 else ""  # Aggregation label (optional)

# Map short aggregation method codes to human-readable names
_METHOD_NAME_MAP = {
    'rrf': 'Reciprocal Rank Fusion',
    'rank_product': 'Rank Product',
    'weighted_borda': 'Weighted Borda Count',
    'sum': 'Simple Sum',
}

def _humanize_agg_label(label: str) -> str:
    """Convert an aggregation label into a human-readable form.

    Expected formats coming from the server:
      - "method=rrf,k=60"
      - "method=weighted_borda,weights={...}"
    Also be robust to legacy/short forms like just "rrf".
    """
    if not label:
        return ""

    s = str(label).strip()
    low = s.lower()

    # If it's just the bare method token, expand directly
    if low in _METHOD_NAME_MAP:
        return _METHOD_NAME_MAP[low]

    # Otherwise parse comma-separated key=value pairs, replacing method value
    try:
        parts = [p.strip() for p in re.split(r"\s*,\s*", s) if p.strip()]
    except Exception:
        parts = [s]

    out_parts = []
    method_seen = False
    for p in parts:
        m = re.match(r"(?i)^method\s*=\s*(.+)$", p)
        if m:
            method_seen = True
            val = m.group(1).strip().lower()
            readable = _METHOD_NAME_MAP.get(val, m.group(1).strip())
            # Prefer to show method name alone (without the "method=" prefix)
            out_parts.append(readable)
        else:
            out_parts.append(p)

    # If no explicit method= was present but the string starts with a known token, expand best-effort
    if not method_seen:
        maybe = parts[0].lower()
        if maybe in _METHOD_NAME_MAP:
            parts[0] = _METHOD_NAME_MAP[maybe]
            return ", ".join([parts[0]] + parts[1:])

    return ", ".join(out_parts)

# Extract analysis name from data_path (remove 'uploads/' and .csv extension)
# Example: "uploads/GSE120584_serum_norm.csv" -> "GSE120584_serum_norm"
file_name = os.path.basename(data_path).split('.')[0]

# Resolve ranked features CSV path: prefer explicit csv_path; otherwise
# use class_pair + agg_label method folder (e.g., method=rrf_k=60)
if csv_path and str(csv_path).strip():
    ranked_features_path = csv_path
else:
    base_dir = os.path.join("results", file_name)
    if class_pair and str(class_pair).strip():
        if agg_label and str(agg_label).strip():
            ranked_features_path = os.path.join(
                base_dir, "feature_ranking", class_pair, str(agg_label), "ranked_features_df.csv"
            )
        else:
            ranked_features_path = os.path.join(
                base_dir, "feature_ranking", class_pair, "ranked_features_df.csv"
            )
    else:
        ranked_features_path = os.path.join(base_dir, "ranked_features_df.csv")

# Read the CSV file (feature ranking CSVs are written with ';' separator)
def _read_ranked_csv(path):
    try:
        _df = pd.read_csv(path, sep=';')
        if _df.shape[1] <= 1:
            _df = pd.read_csv(path)
        return _df
    except Exception:
        return pd.read_csv(path)

df = None
if os.path.exists(ranked_features_path):
    df = _read_ranked_csv(ranked_features_path)
else:
    # Fallbacks
    legacy_pair_path = os.path.join("results", file_name, "feature_ranking", str(class_pair or ""), "ranked_features_df.csv")
    legacy_root_path = os.path.join("results", file_name, "ranked_features_df.csv")
    if os.path.exists(legacy_pair_path):
        df = _read_ranked_csv(legacy_pair_path)
        ranked_features_path = legacy_pair_path
    elif os.path.exists(legacy_root_path):
        df = _read_ranked_csv(legacy_root_path)
        ranked_features_path = legacy_root_path
    else:
        print(f"Ranked features CSV not found at '{ranked_features_path}'", file=sys.stderr)
        sys.exit(1)

# Some ranked CSVs may not include this column; ignore if missing
df.drop(columns=["overall score"], inplace=True, errors="ignore")

# Optional: compute Mean Rank for reference only (not used for ordering Top-N)
numeric_part = df.iloc[:, 1:].apply(pd.to_numeric, errors='coerce')
mean_rank = numeric_part.mean(axis=1, skipna=True)
global_max = pd.to_numeric(numeric_part.max().max(), errors='coerce')
if pd.isna(global_max):
    global_max = 1e9
safe_mean = pd.to_numeric(mean_rank, errors='coerce').fillna(float(global_max) + 1000.0)
df["Mean Rank"] = np.rint(safe_mean.astype(float)).astype(int)

# Select Top-N strictly by the CSV order (i.e., chosen aggregation’s ranking)
df_top = df.head(feature_count).copy()

# Find the appropriate feature column name (feature type)
feature_column = df_top.columns[0]  # First column is feature type (microRNA, gene, etc)

from math import isfinite

# Add Aggregation Rank (1..N) for clarity
df_top.insert(1, "Aggregation Rank", np.arange(1, len(df_top) + 1))

# If Reciprocal Rank Fusion is used, compute and show RRF Score = Σ 1/(k + rank)
rrf_match = re.search(r'rrf_k\s*=\s*(\d+)', str(agg_label))
if rrf_match:
    try:
        k = int(rrf_match.group(1))
    except Exception:
        k = 60
    rank_cols = [c for c in df_top.columns if c not in [df_top.columns[0], "Aggregation Rank", "Mean Rank"]]
    numeric_ranks = df_top[rank_cols].apply(pd.to_numeric, errors='coerce')
    rrf_score = numeric_ranks.apply(lambda row: np.nansum(1.0 / (k + row.values.astype(float))), axis=1)
    df_top.insert(2, "RRF Score", pd.to_numeric(rrf_score, errors='coerce').round(6))

# Visualization settings - adjust for larger size
column_count = (df_top.shape[1] - 1)  # excluding feature column in index later
min_width = max(12, column_count * 1.5)
height = min(15, max(6, feature_count/3 + 5))
plt.figure(figsize=(min_width, height))

# Prepare data for heatmap (numeric values, integer formatting)
plot_df = df_top.set_index(feature_column)
# Hide Mean Rank in the visualization to avoid confusion
plot_df = plot_df.drop(columns=["Mean Rank"], errors="ignore")
# Convert all cells to numeric where possible and round for display
plot_df = plot_df.apply(pd.to_numeric, errors='coerce').round()

# Use a more readable and high-contrast color palette ("magma")
ax = sns.heatmap(
    plot_df,
    annot=True,
    cmap="magma_r",
    fmt="g",  # generic; with rounded numbers this shows integers
    linewidths=0.7,
    linecolor="gray",
    square=False,
    annot_kws={"size": 14}
)

# Output directory (labeled per aggregation if provided)
if class_pair:
    outdir = os.path.join("results", file_name, "summaryStatisticalMethods", class_pair)
else:
    outdir = os.path.join("results", file_name, "summaryStatisticalMethods")

if agg_label:
    safe_label = re.sub(r'[^A-Za-z0-9._=+\-]+', '_', agg_label)
    outdir = os.path.join(outdir, safe_label)

# Create folders if they do not exist
os.makedirs(os.path.join(outdir, "png"), exist_ok=True)
os.makedirs(os.path.join(outdir, "pdf"), exist_ok=True)

human_label = _humanize_agg_label(agg_label)
if class_pair:
    class_pair_display = class_pair.replace('_', ' vs ')
    title_text = (
        f"Top {feature_count} Biomarkers by Chosen Aggregation\n"
        f"for Class Pair: {class_pair_display}"
        + (f" (Aggregation: {human_label})" if human_label else "")
    )
else:
    title_text = f"Top {feature_count} Biomarkers by Chosen Aggregation" + (f" (Aggregation: {human_label})" if human_label else "")

# Set font size
fontsize = 20 if column_count >= 5 else 18

# Set title and labels with larger font size
plt.title(title_text, fontsize=fontsize, fontweight="bold", pad=20)
plt.xticks(rotation=45, ha="right", fontsize=18)
plt.yticks(rotation=0, fontsize=18)
plt.xlabel("Methods and Aggregation Metrics", fontsize=24)
plt.ylabel(feature_column, fontsize=24)

# Expand and adjust plot area
plt.subplots_adjust(top=0.92, bottom=0.15, left=0.20, right=0.95)

# Apply tight_layout for proper content placement
plt.tight_layout()

# Save files with higher resolution
safe_name = re.sub(r'[^A-Za-z0-9._=+\-]+', '_', str(agg_label or ''))
base_stem = "summary_of_statistical_methods_plot"
file_stem = f"{base_stem}_{safe_name}" if safe_name else base_stem

png_output_path = os.path.join(outdir, "png", f"{file_stem}.png")
plt.savefig(png_output_path, dpi=400, bbox_inches='tight')

# Print relative path (to be used by server.js)
print(png_output_path)

# Save as PDF
pdf_output_path = os.path.join(outdir, "pdf", f"{file_stem}.pdf")
plt.savefig(pdf_output_path, dpi=400, bbox_inches='tight')
plt.close()

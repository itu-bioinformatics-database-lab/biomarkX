import os, sys
import json
import argparse
import matplotlib
matplotlib.use("Agg")  # ensure headless-friendly backend
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import re


# Add modules directory to sys.path and import helper
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from modules.utils import load_table
from modules.logger import logging

def sanitize_filename(name: str) -> str:
    # Replace unsafe chars and collapse spaces
    name = re.sub(r"[^\w\-\.]+", "_", name.strip())
    return name or "column"

# Load data and print unique values of the specified column
def load_data(data_path, column_name, outdir):
    os.makedirs(outdir, exist_ok=True)
    # Performant path: try reading only the selected column
    try:
        if data_path.lower().endswith('.xlsx'):
            df = pd.read_excel(data_path, usecols=[column_name])
        else:
            # Use pandas default engine for speed; only one column
            df = pd.read_csv(data_path, usecols=[column_name])
    except Exception:
        # Fallback: load full table and select the column
        df_all = load_table(data_path)
        if column_name not in df_all.columns:
            raise ValueError(f"Column '{column_name}' not found in file: {data_path}")
        df = df_all[[column_name]]
    # Print unique classes (list)
    print(df[column_name].dropna().unique().tolist())
    # Print per-class sample counts as JSON (line 2 of output)
    counts_dict = {str(k): int(v) for k, v in df[column_name].dropna().value_counts().items()}
    print(json.dumps(counts_dict))
    return df

# Visualize the distribution of a categorical column in the data
def visualize_diagnosis_distribution(df, column_name, outdir):
    # Plot the distribution of the Diagnosis Group
    plt.figure(figsize=(10,6))  # Set the figure size
    ax = sns.countplot(x=column_name, data=df, hue=column_name, saturation=0.95, legend=False)
    for container in ax.containers:
        ax.bar_label(container, label_type='edge', color='black', size=10)
    safe_col = sanitize_filename(column_name)    
    image_path = os.path.join(outdir, f'{safe_col}_distribution.png')
    plt.savefig(image_path, dpi=300, bbox_inches='tight')
    plt.close()
    print(image_path)

# Main script execution
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python get_classes.py <data_path> <column_name>", file=sys.stderr)
        sys.exit(1)

    # Get parameters
    data_path = sys.argv[1]
    column_name = sys.argv[2]

    # Output directory
    base_name = os.path.basename(data_path)
    file_name_without_ext = os.path.splitext(base_name)[0]
    outdir = os.path.join("results", file_name_without_ext)
    
    try:
        df = load_data(data_path, column_name, outdir)
        visualize_diagnosis_distribution(df, column_name, outdir)
    except Exception as e:
        logging.exception("Error while processing")
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)

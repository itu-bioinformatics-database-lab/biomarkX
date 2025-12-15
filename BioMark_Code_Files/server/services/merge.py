import sys
import os
import pandas as pd
import json
import uuid
from datetime import datetime


def merge_files(chosen_columns):
    dfs = []
    column_metadata = {}

    for info in chosen_columns:
        path = info['filePath']
        sample_col = info['sampleColumn']

        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")

        df = pd.read_csv(path, low_memory=False)

        # Ensure sample column exists
        if sample_col not in df.columns:
            raise ValueError(f"Sample column '{sample_col}' not found in {path}")

        # Track column origins and drop duplicates except for the join key
        for col in list(df.columns):
            if col == sample_col:
                continue

            if col in column_metadata:
                # Already seen -> drop duplicate column
                df.drop(columns=[col], inplace=True)
            else:
                # First occurrence -> remember where it came from
                column_metadata[col] = path

        dfs.append((df, sample_col))

    # Merge all dataframes using their sample column
    merged_df = dfs[0][0].copy()
    key_col = dfs[0][1]

    for df, sample_col in dfs[1:]:
        merged_df = pd.merge(
            merged_df,
            df,
            left_on=key_col,
            right_on=sample_col,
            how='inner',
            suffixes=('', '_dup')
        )

        # Drop duplicated sample columns
        if sample_col != key_col:
            merged_df.drop(columns=[sample_col], inplace=True)

    # Rename the key column to a standardized name to avoid confusion
    # This ensures the merged file always has "Sample ID" as the sample column
    if key_col != "Sample ID":
        merged_df.rename(columns={key_col: "Sample ID"}, inplace=True)
        key_col = "Sample ID"

    # Convert numeric columns to float for consistency
    for col in merged_df.select_dtypes(include=['int64', 'float64']).columns:
        merged_df[col] = merged_df[col].astype(float)

    # Persist merged dataset into uploads directory with a fresh UUID prefix
    uploads_dir = os.path.join('uploads')
    os.makedirs(uploads_dir, exist_ok=True)
    upload_id = uuid.uuid4().hex
    merged_filename = f"{upload_id}_merged_dataset.csv"
    merged_file_path = os.path.join(uploads_dir, merged_filename)
    merged_df.to_csv(merged_file_path, index=False)

    # Save enhanced metadata alongside other results for traceability
    metadata_dir = os.path.join('results', 'merged_files')
    os.makedirs(metadata_dir, exist_ok=True)
    metadata = {
        "merged_id": upload_id,
        "timestamp": datetime.now().isoformat(),
        "merge_type": "inner",
        "unified_sample_column": key_col,  # Always "Sample ID" after standardization
        "input_files": {},
        "merged_file": merged_file_path,
        "merged_columns": merged_df.columns.tolist(),
        "size_bytes": os.path.getsize(merged_file_path)
    }

    for info in chosen_columns:
        path = info['filePath']
        illness_col = info['illnessColumn']
        sample_col = info['sampleColumn']
        df_cols = pd.read_csv(path, nrows=0).columns.tolist()
        basename = os.path.basename(path)
        clean_name = basename.split('_', 1)[1] if '_' in basename else basename

        metadata["input_files"][clean_name] = {
            "illness_column": illness_col,
            "sample_column": sample_col,
            "columns": df_cols
        }

    metadata_path = os.path.join(metadata_dir, f"{upload_id}_metadata.json")
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    return {
        'mergedFilePath': merged_file_path,
        'metadataPath': metadata_path,
        'columns': merged_df.columns.tolist(),
        'uploadId': upload_id,
        'mergedFileName': merged_filename,
        'sizeBytes': metadata['size_bytes'],
        'unifiedSampleColumn': key_col  # Always "Sample ID"
    }

if __name__ == "__main__":
    chosen_columns = json.loads(sys.argv[1])
    try:
        result = merge_files(chosen_columns)
        print(json.dumps(result, indent=2))
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)


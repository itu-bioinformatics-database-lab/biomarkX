import json
import sys
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import numpy as np
import pandas as pd


def _read_payload():
    raw = sys.stdin.read()
    if not raw:
        return {}
    return json.loads(raw)


def _to_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    return bool(value)


def _coerce_column_list(value):
    if value is None:
        return []
    if isinstance(value, str):
        val = value.strip()
        return [val] if val else []
    if isinstance(value, (list, tuple, set)):
        cols = []
        for item in value:
            if isinstance(item, str):
                val = item.strip()
                if val:
                    cols.append(val)
        return cols
    return []


def _collect_selected_columns(payload, singular_key, plural_key):
    merged = []
    merged.extend(_coerce_column_list(payload.get(plural_key)))
    merged.extend(_coerce_column_list(payload.get(singular_key)))

    deduped = []
    seen = set()
    for col in merged:
        if col not in seen:
            deduped.append(col)
            seen.add(col)
    return deduped


def _build_pipeline(raw_pipeline):
    log_cfg = raw_pipeline.get("logTransformation", {}) if isinstance(raw_pipeline, dict) else {}
    batch_cfg = raw_pipeline.get("batchEffectCorrection", {}) if isinstance(raw_pipeline, dict) else {}
    norm_cfg = raw_pipeline.get("normalization", {}) if isinstance(raw_pipeline, dict) else {}
    outlier_cfg = raw_pipeline.get("outlierDetection", {}) if isinstance(raw_pipeline, dict) else {}

    pipeline = {
        "logTransformation": {
            "requested": _to_bool(log_cfg.get("requested"), True),
            "base": log_cfg.get("base", 2),
            "offset": log_cfg.get("offset", 1),
        },
        "batchEffectCorrection": {
            "requested": _to_bool(batch_cfg.get("requested"), True),
            "method": str(batch_cfg.get("method", "combat")).lower(),
            "batchColumn": batch_cfg.get("batchColumn", ""),
            "covariates": batch_cfg.get("covariates", []) if isinstance(batch_cfg.get("covariates", []), list) else [],
            "parametric": _to_bool(batch_cfg.get("parametric"), True),
        },
        "normalization": {
            "requested": _to_bool(norm_cfg.get("requested"), True),
            "method": norm_cfg.get("method", "zscore"),
            "zscore": norm_cfg.get("zscore", {"center": True, "scale": True}),
            "minmax": norm_cfg.get("minmax", {"rangeMin": 0, "rangeMax": 1}),
            "quantile": norm_cfg.get("quantile", {"tieBreaking": "mean"}),
        },
        "outlierDetection": {
            "requested": _to_bool(outlier_cfg.get("requested"), True),
            "method": outlier_cfg.get("method", "iqr"),
            "iqrCoefficient": outlier_cfg.get("iqrCoefficient", 1.5),
            "zscoreDeviation": outlier_cfg.get("zscoreDeviation", 3),
            "action": outlier_cfg.get("action", "impute"),
        },
    }

    requested_steps = [
        key for key, cfg in pipeline.items()
        if isinstance(cfg, dict) and _to_bool(cfg.get("requested"), False)
    ]

    return pipeline, requested_steps


def _resolve_existing_path(file_path):
    candidates = [
        Path(file_path),
        Path(__file__).resolve().parents[1] / file_path,
        Path.cwd() / file_path,
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError(f"Input file not found: {file_path}")


def _safe_to_numeric(df, columns):
    numeric_df = pd.DataFrame(index=df.index)
    for col in columns:
        series = pd.to_numeric(df[col], errors="coerce")
        if not series.isna().all():
            numeric_df[col] = series
    return numeric_df


def _feature_columns(df, protected_columns):
    candidates = [c for c in df.columns if c not in protected_columns]
    numeric_df = _safe_to_numeric(df, candidates)
    return list(numeric_df.columns)


def _log_transform(df, feature_cols, cfg):
    if not feature_cols:
        return {"applied": False, "columnsProcessed": 0, "shiftedColumns": 0}

    base = cfg.get("base", 2)
    try:
        base = float(base)
    except Exception:
        base = 2.0
    if base <= 0 or np.isclose(base, 1.0):
        base = 2.0

    offset = cfg.get("offset", 1)
    try:
        offset = float(offset)
    except Exception:
        offset = 1.0

    shifted_columns = 0
    for col in feature_cols:
        series = pd.to_numeric(df[col], errors="coerce")
        shifted = series + offset
        min_val = shifted.min(skipna=True)
        extra_shift = 0.0
        if pd.notna(min_val) and min_val <= 0:
            extra_shift = abs(float(min_val)) + 1e-9
            shifted = shifted + extra_shift
            shifted_columns += 1

        transformed = np.log(shifted) / np.log(base)
        df[col] = transformed

    return {
        "applied": True,
        "columnsProcessed": len(feature_cols),
        "base": base,
        "offset": offset,
        "shiftedColumns": shifted_columns,
    }


def _build_covariate_design(df, covariates):
    if not covariates:
        return np.ones((len(df), 1), dtype=float)

    existing_covariates = [c for c in covariates if c in df.columns]
    if not existing_covariates:
        return np.ones((len(df), 1), dtype=float)

    cov_df = df[existing_covariates].copy()
    for col in cov_df.columns:
        as_num = pd.to_numeric(cov_df[col], errors="coerce")
        numeric_ratio = as_num.notna().mean()
        if numeric_ratio >= 0.8:
            cov_df[col] = as_num.fillna(as_num.median())
        else:
            cov_df[col] = cov_df[col].astype(str).fillna("NA")

    cov_df = pd.get_dummies(cov_df, drop_first=True)
    if cov_df.shape[1] == 0:
        return np.ones((len(df), 1), dtype=float)

    x = cov_df.to_numpy(dtype=float)
    intercept = np.ones((x.shape[0], 1), dtype=float)
    return np.hstack([intercept, x])


def _combat_like_batch_correction(df, feature_cols, cfg):
    if not feature_cols:
        return {"applied": False, "reason": "no_feature_columns"}

    batch_column = cfg.get("batchColumn", "")
    if not batch_column or batch_column not in df.columns:
        return {"applied": False, "reason": "invalid_batch_column", "batchColumn": batch_column}

    batch_series = df[batch_column].astype(str).fillna("NA")
    unique_batches = batch_series.unique()
    if len(unique_batches) < 2:
        return {"applied": False, "reason": "single_batch", "batchCount": int(len(unique_batches))}

    covariates = cfg.get("covariates", [])
    if isinstance(covariates, list):
        covariates = [c for c in covariates if c != batch_column]
    else:
        covariates = []

    x = _build_covariate_design(df, covariates)

    for col in feature_cols:
        y = pd.to_numeric(df[col], errors="coerce").astype(float)
        y_filled = y.fillna(y.median())
        y_np = y_filled.to_numpy(dtype=float)

        beta, _, _, _ = np.linalg.lstsq(x, y_np, rcond=None)
        fitted = x @ beta
        resid = y_np - fitted

        global_mean = float(np.mean(resid))
        global_std = float(np.std(resid))
        if global_std <= 1e-12:
            global_std = 1.0

        corrected = resid.copy()
        for batch in unique_batches:
            mask = (batch_series == batch).to_numpy()
            if not np.any(mask):
                continue
            batch_vals = resid[mask]
            b_mean = float(np.mean(batch_vals))
            b_std = float(np.std(batch_vals))
            if b_std <= 1e-12:
                b_std = 1.0
            corrected[mask] = ((batch_vals - b_mean) / b_std) * global_std + global_mean

        adjusted = corrected + fitted
        df[col] = adjusted

    return {
        "applied": True,
        "method": cfg.get("method", "combat"),
        "batchColumn": batch_column,
        "batchCount": int(len(unique_batches)),
        "covariatesUsed": covariates,
        "columnsProcessed": len(feature_cols),
    }


def _zscore_normalize(df, feature_cols, zcfg):
    center = _to_bool(zcfg.get("center"), True)
    scale = _to_bool(zcfg.get("scale"), True)
    for col in feature_cols:
        series = pd.to_numeric(df[col], errors="coerce").astype(float)
        if center:
            series = series - series.mean(skipna=True)
        if scale:
            std = series.std(skipna=True)
            if pd.notna(std) and std > 1e-12:
                series = series / std
        df[col] = series


def _minmax_normalize(df, feature_cols, mcfg):
    range_min = mcfg.get("rangeMin", 0)
    range_max = mcfg.get("rangeMax", 1)
    try:
        range_min = float(range_min)
        range_max = float(range_max)
    except Exception:
        range_min, range_max = 0.0, 1.0

    if range_max <= range_min:
        range_min, range_max = 0.0, 1.0

    target_span = range_max - range_min
    for col in feature_cols:
        series = pd.to_numeric(df[col], errors="coerce").astype(float)
        min_val = series.min(skipna=True)
        max_val = series.max(skipna=True)
        span = max_val - min_val
        if pd.isna(span) or span <= 1e-12:
            df[col] = range_min
            continue
        normalized = (series - min_val) / span
        df[col] = normalized * target_span + range_min


def _quantile_normalize(df, feature_cols, qcfg):
    if not feature_cols:
        return

    tie_method = str((qcfg or {}).get("tieBreaking", "mean")).lower()
    rank_method = {
        "mean": "average",
        "average": "average",
        "min": "min",
        "max": "max",
        "first": "first",
        "dense": "dense",
    }.get(tie_method, "average")

    matrix = df[feature_cols].apply(pd.to_numeric, errors="coerce")
    filled = matrix.apply(lambda s: s.fillna(s.median()), axis=0)

    sorted_vals = np.sort(filled.to_numpy(dtype=float), axis=0)
    mean_sorted = np.mean(sorted_vals, axis=1)
    n = mean_sorted.shape[0]

    normalized = pd.DataFrame(index=filled.index, columns=filled.columns, dtype=float)
    rank_grid = np.arange(n, dtype=float)

    if tie_method == "random":
        rng = np.random.default_rng(None) # differnt seed each run

        for col in filled.columns:
            values = filled[col].to_numpy(dtype=float)
            order = np.argsort(values, kind="mergesort")
            randomized_ranks = np.empty(n, dtype=float)

            start = 0
            while start < n:
                end = start
                while end + 1 < n and values[order[end + 1]] == values[order[start]]:
                    end += 1

                rank_slots = np.arange(start, end + 1, dtype=float)
                if end > start:
                    rng.shuffle(rank_slots)
                randomized_ranks[order[start:end + 1]] = rank_slots
                start = end + 1

            normalized[col] = np.interp(randomized_ranks, rank_grid, mean_sorted)

        for col in feature_cols:
            df[col] = normalized[col]
        return

    for col in filled.columns:
        series = filled[col]
        ranks = series.rank(method=rank_method).to_numpy(dtype=float) - 1.0
        ranks = np.clip(ranks, 0.0, n - 1.0)
        normalized[col] = np.interp(ranks, rank_grid, mean_sorted)

    for col in feature_cols:
        df[col] = normalized[col]


def _apply_normalization(df, feature_cols, cfg):
    method = str(cfg.get("method", "zscore")).lower()
    if method == "zscore":
        _zscore_normalize(df, feature_cols, cfg.get("zscore", {}))
    elif method == "minmax":
        _minmax_normalize(df, feature_cols, cfg.get("minmax", {}))
    elif method == "quantile":
        _quantile_normalize(df, feature_cols, cfg.get("quantile", {}))
    else:
        _zscore_normalize(df, feature_cols, cfg.get("zscore", {}))
        method = "zscore"

    return {
        "applied": True,
        "method": method,
        "columnsProcessed": len(feature_cols),
    }


def _outlier_mask(series, method, iqr_coeff, zscore_dev):
    clean = pd.to_numeric(series, errors="coerce").astype(float)
    if clean.isna().all():
        return pd.Series(False, index=series.index)

    if method == "zscore":
        mean = clean.mean(skipna=True)
        std = clean.std(skipna=True)
        if pd.isna(std) or std <= 1e-12:
            return pd.Series(False, index=series.index)
        z = (clean - mean).abs() / std
        return z > zscore_dev

    q1 = clean.quantile(0.25)
    q3 = clean.quantile(0.75)
    iqr = q3 - q1
    if pd.isna(iqr) or iqr <= 1e-12:
        return pd.Series(False, index=series.index)
    lower = q1 - iqr_coeff * iqr
    upper = q3 + iqr_coeff * iqr
    return (clean < lower) | (clean > upper)


def _apply_outlier_detection(df, feature_cols, cfg):
    if not feature_cols:
        return {
            "applied": False,
            "detectedOutlierCells": 0,
            "affectedRows": 0,
            "rowsRemoved": 0,
            "action": str(cfg.get("action", "impute")).lower(),
        }

    method = str(cfg.get("method", "iqr")).lower()
    action = str(cfg.get("action", "impute")).lower()
    iqr_coeff = cfg.get("iqrCoefficient", 1.5)
    zscore_dev = cfg.get("zscoreDeviation", 3)

    try:
        iqr_coeff = float(iqr_coeff)
    except Exception:
        iqr_coeff = 1.5
    try:
        zscore_dev = float(zscore_dev)
    except Exception:
        zscore_dev = 3.0

    combined_mask = pd.Series(False, index=df.index)
    per_row_outlier_counts = pd.Series(0, index=df.index, dtype=int)
    outlier_count = 0
    row_outlier_fraction = 0.15
    min_outlier_features = 5
    per_row_threshold = None

    for col in feature_cols:
        mask = _outlier_mask(df[col], method, iqr_coeff, zscore_dev)
        outlier_count += int(mask.sum())
        per_row_outlier_counts = per_row_outlier_counts.add(mask.astype(int), fill_value=0).astype(int)
        if action == "impute":
            replacement = pd.to_numeric(df[col], errors="coerce").median(skipna=True)
            if pd.isna(replacement):
                replacement = 0.0
            df.loc[mask, col] = replacement
        else:
            combined_mask = combined_mask | mask

    if action == "remove" and combined_mask.any():
        # Row removal policy for high-dimensional data:
        # remove a row only if it has many outlier cells, not just one outlier in thousands of features.
        row_outlier_fraction = cfg.get("rowOutlierFraction", 0.15)
        min_outlier_features = cfg.get("minOutlierFeatures", 5)
        try:
            row_outlier_fraction = float(row_outlier_fraction)
        except Exception:
            row_outlier_fraction = 0.15
        row_outlier_fraction = min(max(row_outlier_fraction, 0.0), 1.0)
        try:
            min_outlier_features = int(min_outlier_features)
        except Exception:
            min_outlier_features = 5
        min_outlier_features = max(1, min_outlier_features)

        per_row_threshold = max(min_outlier_features, int(np.ceil(len(feature_cols) * row_outlier_fraction)))
        removal_mask = per_row_outlier_counts >= per_row_threshold
        removed_rows = int(removal_mask.sum())
        df.drop(index=df.index[removal_mask], inplace=True)
        df.reset_index(drop=True, inplace=True)
    else:
        removed_rows = 0

    return {
        "applied": True,
        "method": method,
        "action": action,
        "detectedOutlierCells": int(outlier_count),
        "affectedRows": int((per_row_outlier_counts > 0).sum()),
        "rowsRemoved": int(removed_rows),
        "rowRemovalPolicy": {
            "rowOutlierFraction": float(row_outlier_fraction) if action == "remove" else None,
            "minOutlierFeatures": int(min_outlier_features) if action == "remove" else None,
            "effectivePerRowThreshold": int(per_row_threshold) if action == "remove" and per_row_threshold is not None else None,
        },
    }


def _build_output_path(input_path):
    root = Path(__file__).resolve().parents[1]
    output_dir = root / "results" / "normalized_files"
    output_dir.mkdir(parents=True, exist_ok=True)

    stem = input_path.stem
    ext = input_path.suffix or ".csv"
    run_id = uuid4().hex[:12]

    merged_match = stem.lower().endswith("_merged_dataset")
    if merged_match:
        merged_id = stem[: -len("_merged_dataset")]
        output_name = f"{merged_id}_merged_dataset_normalized_{run_id}{ext}"
    else:
        id_prefix_match = None
        parts = stem.split("_", 1)
        if parts and len(parts[0]) >= 8:
            id_prefix_match = parts[0]

        if id_prefix_match and len(parts) > 1:
            output_name = f"{id_prefix_match}_{parts[1]}_normalized_{run_id}{ext}"
        elif id_prefix_match:
            output_name = f"{id_prefix_match}_normalized_{run_id}{ext}"
        else:
            output_name = f"{stem}_normalized_{run_id}{ext}"

    return output_dir / output_name


def _relative_to_server_root(path_obj):
    root = Path(__file__).resolve().parents[1]
    try:
        return str(path_obj.resolve().relative_to(root).as_posix())
    except Exception:
        return str(path_obj.resolve())


def _write_audit_log(output_path, audit_payload):
    log_dir = output_path.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{output_path.stem}_normalization_log.json"
    with open(log_path, "w", encoding="utf-8") as fh:
        json.dump(audit_payload, fh, indent=2)
    return log_path


def _run_pipeline(file_path, pipeline, selected_illness_columns, selected_sample_columns, selected_protected_columns):
    resolved_input = _resolve_existing_path(file_path)
    df = pd.read_csv(resolved_input)
    input_rows = int(df.shape[0])
    input_cols = int(df.shape[1])

    globally_protected = {
        c for c in (selected_illness_columns + selected_sample_columns + selected_protected_columns)
        if isinstance(c, str) and c
    }

    feature_cols = _feature_columns(df, globally_protected)
    if not feature_cols:
        raise ValueError("No numeric feature columns found to normalize.")

    batch_protected = set(globally_protected)
    batch_column = pipeline.get("batchEffectCorrection", {}).get("batchColumn", "")
    if batch_column:
        batch_protected.add(batch_column)
    covariates = pipeline.get("batchEffectCorrection", {}).get("covariates", [])
    if isinstance(covariates, list):
        batch_protected.update([c for c in covariates if isinstance(c, str)])

    batch_feature_cols = _feature_columns(df, batch_protected)

    step_stats = {}

    if pipeline.get("logTransformation", {}).get("requested"):
        step_stats["logTransformation"] = _log_transform(df, feature_cols, pipeline.get("logTransformation", {}))

    if pipeline.get("batchEffectCorrection", {}).get("requested"):
        step_stats["batchEffectCorrection"] = _combat_like_batch_correction(df, batch_feature_cols, pipeline.get("batchEffectCorrection", {}))

    if pipeline.get("normalization", {}).get("requested"):
        step_stats["normalization"] = _apply_normalization(df, feature_cols, pipeline.get("normalization", {}))

    outlier_stats = {
        "applied": False,
        "detectedOutlierCells": 0,
        "affectedRows": 0,
        "rowsRemoved": 0,
        "action": "impute",
    }
    if pipeline.get("outlierDetection", {}).get("requested"):
        outlier_stats = _apply_outlier_detection(df, feature_cols, pipeline.get("outlierDetection", {}))
        step_stats["outlierDetection"] = outlier_stats

    output_path = _build_output_path(resolved_input)
    df.to_csv(output_path, index=False)
    output_rows = int(df.shape[0])
    output_cols = int(df.shape[1])

    summary = {
        "inputRowCount": input_rows,
        "outputRowCount": output_rows,
        "rowsRemoved": max(0, input_rows - output_rows),
        "inputColumnCount": input_cols,
        "outputColumnCount": output_cols,
        "featureColumnCount": int(len(feature_cols)),
        "detectedOutliers": int(outlier_stats.get("detectedOutlierCells", 0)),
    }

    audit_payload = {
        "receivedAt": datetime.utcnow().isoformat() + "Z",
        "inputFilePath": str(resolved_input),
        "outputFilePath": str(output_path),
        "protectedColumns": sorted(list(globally_protected)),
        "batchProtectedColumns": sorted(list(batch_protected)),
        "pipeline": pipeline,
        "summary": summary,
        "stepStats": step_stats,
    }
    log_path = _write_audit_log(output_path, audit_payload)

    return {
        "inputFilePath": _relative_to_server_root(resolved_input),
        "outputFilePath": _relative_to_server_root(output_path),
        "rowCount": output_rows,
        "columnCount": output_cols,
        "featureColumnCount": int(len(feature_cols)),
        "detectedOutliers": int(outlier_stats.get("detectedOutlierCells", 0)),
        "inputRowCount": input_rows,
        "rowsRemoved": int(max(0, input_rows - output_rows)),
        "normalizationLogPath": _relative_to_server_root(log_path),
        "stepStats": step_stats,
    }


def main():
    try:
        payload = _read_payload()
    except Exception as ex:
        print(json.dumps({
            "success": False,
            "message": f"Invalid JSON payload: {ex}"
        }))
        return

    file_path = payload.get("filePath")
    if not file_path:
        print(json.dumps({
            "success": False,
            "message": "filePath is required."
        }))
        return

    pipeline, requested_steps = _build_pipeline(payload.get("normalizationPipeline", {}))
    selected_illness_columns = _collect_selected_columns(payload, "selectedIllnessColumn", "selectedIllnessColumns")
    selected_sample_columns = _collect_selected_columns(payload, "selectedSampleColumn", "selectedSampleColumns")
    selected_protected_columns = _collect_selected_columns(payload, "selectedProtectedColumn", "selectedProtectedColumns")

    selected_protected_columns = [
        col for col in selected_protected_columns
        if col not in set(selected_illness_columns)
    ]

    batch_cfg = pipeline.get("batchEffectCorrection", {})
    if batch_cfg.get("requested") and not batch_cfg.get("batchColumn"):
        print(json.dumps({
            "success": False,
            "message": "Batch effect correction requires a batch column."
        }))
        return

    try:
        execution_info = _run_pipeline(
            file_path=file_path,
            pipeline=pipeline,
            selected_illness_columns=selected_illness_columns,
            selected_sample_columns=selected_sample_columns,
            selected_protected_columns=selected_protected_columns,
        )
    except Exception as ex:
        print(json.dumps({
            "success": False,
            "message": f"Normalization execution failed: {ex}"
        }))
        return

    response = {
        "success": True,
        "message": "Normalization pipeline executed successfully.",
        "data": {
            **execution_info,
            "receivedAt": datetime.utcnow().isoformat() + "Z",
            "analysisId": payload.get("analysisId"),
            "selectedIllnessColumn": payload.get("selectedIllnessColumn"),
            "selectedSampleColumn": payload.get("selectedSampleColumn"),
            "selectedIllnessColumns": selected_illness_columns,
            "selectedSampleColumns": selected_sample_columns,
            "selectedProtectedColumns": selected_protected_columns,
            "requestedSteps": requested_steps,
            "normalizationPipeline": pipeline,
        }
    }

    print(json.dumps(response))


if __name__ == "__main__":
    main()

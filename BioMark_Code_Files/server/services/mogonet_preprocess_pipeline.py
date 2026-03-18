import json
import sys
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.feature_selection import VarianceThreshold, f_classif
from sklearn.preprocessing import MinMaxScaler
from statsmodels.stats.multitest import multipletests


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


def _dedupe_non_empty_columns(values):
    deduped = []
    seen = set()
    for col in _coerce_column_list(values):
        if col not in seen:
            deduped.append(col)
            seen.add(col)
    return deduped


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


def _build_output_path(input_path):
    root = Path(__file__).resolve().parents[1]
    output_dir = root / "results" / "normalized_files"
    output_dir.mkdir(parents=True, exist_ok=True)

    stem = input_path.stem
    ext = input_path.suffix or ".csv"
    run_id = uuid4().hex[:12]

    if stem.lower().endswith("_merged_dataset"):
        merged_id = stem[: -len("_merged_dataset")]
        output_name = f"{merged_id}_merged_dataset_normalized_{run_id}{ext}"
    else:
        parts = stem.split("_", 1)
        id_prefix_match = parts[0] if parts and len(parts[0]) >= 8 else None

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


def _safe_numeric_columns(df, columns):
    numeric_df = pd.DataFrame(index=df.index)
    for col in columns:
        series = pd.to_numeric(df[col], errors="coerce")
        if not series.isna().all():
            # Median imputation keeps preprocessing numerically stable.
            numeric_df[col] = series.fillna(series.median(skipna=True))
    return numeric_df


def _load_hm27_ids(path_value):
    if not isinstance(path_value, str) or not path_value.strip():
        return None

    path_value = path_value.strip()
    candidates = [
        Path(path_value),
        Path(__file__).resolve().parent / path_value,
        Path(__file__).resolve().parents[1] / path_value,
        Path.cwd() / path_value,
    ]

    target = None
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            target = candidate
            break

    if target is None:
        raise FileNotFoundError(f"HM27 artifact file not found: {path_value}")

    with open(target, "r", encoding="utf-8") as fh:
        payload = json.load(fh)

    if not isinstance(payload, list):
        raise ValueError("HM27 artifact must be a JSON array of probe ids.")

    return {str(item).strip() for item in payload if str(item).strip()}


def mogonet_preprocess(
    X,
    y,
    omics_type="mRNA",
    fdr_alpha=0.05,
    var_thresh_mrna=0.1,
    var_thresh_meth=0.001,
    pc1_max=0.50,
    min_keep=200,
    max_keep=300,
    hm27_probe_ids=None,
    apply_log_transform=None,
    training_mask=None,
):
    if training_mask is None:
        training_mask = np.ones(len(X), dtype=bool)

    X_train = X.loc[training_mask]
    y_train = y.loc[training_mask]

    if apply_log_transform is None:
        apply_log_transform = str(omics_type).lower() in {"proteomics", "metabolomics"}

    if apply_log_transform:
        X = X.apply(pd.to_numeric, errors="coerce")
        X_train = X_train.apply(pd.to_numeric, errors="coerce")

        X = X.replace([np.inf, -np.inf], np.nan).fillna(0.0).clip(lower=0.0)
        X_train = X_train.replace([np.inf, -np.inf], np.nan).fillna(0.0).clip(lower=0.0)

        with np.errstate(invalid="ignore"):
            positive_train_values = X_train.values[X_train.values > 0]
            min_pos = np.nanmin(positive_train_values) if positive_train_values.size > 0 else np.nan

        if not np.isfinite(min_pos):
            min_pos = 1e-3

        pseudocount = max(min_pos / 2.0, 1e-6)
        X = np.log10(X + pseudocount)
        X_train = np.log10(X_train + pseudocount)

    if hm27_probe_ids is not None:
        keep_cols = [c for c in X.columns if c in hm27_probe_ids]
        if not keep_cols:
            return pd.DataFrame(index=X.index), {
                "selectedFeatureCount": 0,
                "hm27Restricted": True,
                "hm27KeptCount": 0,
            }
        X = X[keep_cols]
        X_train = X_train[keep_cols]

    vt0 = VarianceThreshold(threshold=0.0)
    vt0.fit(X_train.values)
    keep_idx0 = vt0.get_support(indices=True)
    X = X.iloc[:, keep_idx0]
    X_train = X_train.iloc[:, keep_idx0]

    if X_train.shape[1] == 0:
        return pd.DataFrame(index=X.index), {
            "selectedFeatureCount": 0,
            "reason": "no_features_after_zero_variance_filter",
        }

    if hm27_probe_ids is not None or omics_type == "meth":
        vt = VarianceThreshold(threshold=float(var_thresh_meth))
    elif omics_type == "mRNA":
        vt = VarianceThreshold(threshold=float(var_thresh_mrna))
    else:
        vt = VarianceThreshold(threshold=0.0)

    vt.fit(X_train.values)
    keep_idx = vt.get_support(indices=True)
    X = X.iloc[:, keep_idx]
    X_train = X_train.iloc[:, keep_idx]

    if X_train.shape[1] == 0:
        return pd.DataFrame(index=X.index), {
            "selectedFeatureCount": 0,
            "reason": "no_features_after_variance_filter",
        }

    F, pvals = f_classif(X_train.values, y_train.values)
    F = np.nan_to_num(F, nan=0.0)
    pvals = np.nan_to_num(pvals, nan=1.0)
    _, qvals, _, _ = multipletests(pvals, alpha=float(fdr_alpha), method="fdr_bh")

    ranked_idx = np.lexsort((-F, qvals))

    def pc1_explained(idx_slice):
        pca = PCA(n_components=1, svd_solver="full").fit(X_train.iloc[:, idx_slice])
        return float(pca.explained_variance_ratio_[0])

    upper_cap = min(int(max_keep), X_train.shape[1])
    k = min(int(min_keep), upper_cap)
    if k < 1:
        k = 1

    while k <= upper_cap:
        idx_keep = ranked_idx[:k]
        if pc1_explained(idx_keep) < float(pc1_max):
            break
        k += 1

    if k > upper_cap:
        k = min(max(1, int(min_keep)), upper_cap)

    idx_keep = ranked_idx[:k]
    X_sel = X.iloc[:, idx_keep].copy()

    scaler = MinMaxScaler(feature_range=(0, 1))
    scaler.fit(X_train.iloc[:, idx_keep].values)
    X_sel.loc[:, :] = scaler.transform(X_sel.values)

    stats = {
        "selectedFeatureCount": int(X_sel.shape[1]),
        "pc1Max": float(pc1_max),
        "fdrAlpha": float(fdr_alpha),
        "logTransformApplied": bool(apply_log_transform),
        "significantFeatureCount": int((qvals <= float(fdr_alpha)).sum()),
        "hm27Restricted": bool(hm27_probe_ids is not None),
        "hm27KeptCount": int(len([c for c in X_sel.columns if hm27_probe_ids and c in hm27_probe_ids])) if hm27_probe_ids is not None else None,
    }
    return X_sel, stats


def _run_pipeline(payload):
    file_path = payload.get("filePath")
    if not file_path:
        raise ValueError("filePath is required.")

    pipeline = payload.get("normalizationPipeline", {})
    mogonet_cfg = pipeline.get("mogonetPreprocess", {}) if isinstance(pipeline, dict) else {}

    resolved_input = _resolve_existing_path(file_path)
    df = pd.read_csv(resolved_input)

    selected_illness_columns = _collect_selected_columns(payload, "selectedIllnessColumn", "selectedIllnessColumns")
    selected_sample_columns = _collect_selected_columns(payload, "selectedSampleColumn", "selectedSampleColumns")
    selected_protected_columns = _collect_selected_columns(payload, "selectedProtectedColumn", "selectedProtectedColumns")

    illness_column = next((c for c in selected_illness_columns if c in df.columns), None)
    if not illness_column:
        raise ValueError("A valid selectedIllnessColumn is required for MOGONET preprocessing.")

    globally_protected = _dedupe_non_empty_columns([
        *selected_illness_columns,
        *selected_sample_columns,
        *selected_protected_columns,
    ])

    feature_candidates = [c for c in df.columns if c not in set(globally_protected)]
    X = _safe_numeric_columns(df, feature_candidates)
    if X.shape[1] == 0:
        raise ValueError("No numeric feature columns found for MOGONET preprocessing.")

    y = df[illness_column].astype(str)
    if y.nunique(dropna=True) < 2:
        raise ValueError("MOGONET preprocessing requires at least two classes in selected illness column.")

    omics_type = str(mogonet_cfg.get("omicsType", "mRNA"))
    apply_log_transform_raw = mogonet_cfg.get("applyLogTransform")
    if apply_log_transform_raw is None:
        apply_log_transform = str(omics_type).lower() in {"proteomics", "metabolomics"}
    else:
        apply_log_transform = _to_bool(apply_log_transform_raw, False)

    hm27_probe_ids = None
    hm27_restriction = _to_bool(mogonet_cfg.get("hm27Restriction"), False)
    if hm27_restriction:
        hm27_probe_ids = _load_hm27_ids(mogonet_cfg.get("hm27ArtifactPath", ""))

    X_sel, mogonet_stats = mogonet_preprocess(
        X=X,
        y=y,
        omics_type=omics_type,
        apply_log_transform=apply_log_transform,
        fdr_alpha=mogonet_cfg.get("fdrAlpha", 0.05),
        var_thresh_mrna=mogonet_cfg.get("varThreshMrna", 0.1),
        var_thresh_meth=mogonet_cfg.get("varThreshMeth", 0.001),
        pc1_max=mogonet_cfg.get("pc1Max", 0.5),
        min_keep=mogonet_cfg.get("minKeep", 200),
        max_keep=mogonet_cfg.get("maxKeep", 300),
        hm27_probe_ids=hm27_probe_ids,
    )

    protected_in_order = [c for c in df.columns if c in set(globally_protected)]
    output_df = pd.concat([df[protected_in_order].copy(), X_sel], axis=1)

    output_path = _build_output_path(resolved_input)
    output_df.to_csv(output_path, index=False)

    summary = {
        "inputRowCount": int(df.shape[0]),
        "outputRowCount": int(output_df.shape[0]),
        "inputColumnCount": int(df.shape[1]),
        "outputColumnCount": int(output_df.shape[1]),
        "featureColumnCount": int(X.shape[1]),
        "selectedFeatureColumnCount": int(X_sel.shape[1]),
        "rowsRemoved": 0,
    }

    effective_pipeline = {
        "mogonetPreprocess": {
            "requested": True,
            "applyLogTransform": bool(apply_log_transform),
            "fdrAlpha": float(mogonet_cfg.get("fdrAlpha", 0.05)),
            "varThreshMrna": float(mogonet_cfg.get("varThreshMrna", 0.1)),
            "varThreshMeth": float(mogonet_cfg.get("varThreshMeth", 0.001)),
            "pc1Max": float(mogonet_cfg.get("pc1Max", 0.5)),
            "minKeep": int(mogonet_cfg.get("minKeep", 200)),
            "maxKeep": int(mogonet_cfg.get("maxKeep", 300)),
            "hm27Restriction": bool(hm27_restriction),
            "hm27ArtifactPath": mogonet_cfg.get("hm27ArtifactPath"),
            "verbose": _to_bool(mogonet_cfg.get("verbose"), True),
        }
    }

    audit_payload = {
        "receivedAt": datetime.utcnow().isoformat() + "Z",
        "normalizationPipelineType": "mogonet",
        "inputFilePath": str(resolved_input),
        "outputFilePath": str(output_path),
        "selectedIllnessColumn": illness_column,
        "selectedIllnessColumns": selected_illness_columns,
        "selectedSampleColumns": selected_sample_columns,
        "selectedProtectedColumns": selected_protected_columns,
        "protectedColumns": protected_in_order,
        "normalizationPipeline": effective_pipeline,
        "summary": summary,
        "stepStats": {
            "mogonetPreprocess": mogonet_stats,
        },
    }
    log_path = _write_audit_log(output_path, audit_payload)

    return {
        "inputFilePath": _relative_to_server_root(resolved_input),
        "outputFilePath": _relative_to_server_root(output_path),
        "rowCount": int(output_df.shape[0]),
        "columnCount": int(output_df.shape[1]),
        "featureColumnCount": int(X.shape[1]),
        "selectedFeatureColumnCount": int(X_sel.shape[1]),
        "inputRowCount": int(df.shape[0]),
        "rowsRemoved": 0,
        "detectedOutliers": 0,
        "normalizationLogPath": _relative_to_server_root(log_path),
        "stepStats": {
            "mogonetPreprocess": mogonet_stats,
        },
        "normalizationPipelineType": "mogonet",
        "normalizationPipeline": effective_pipeline,
    }


def main():
    try:
        payload = _read_payload()
    except Exception as ex:
        print(json.dumps({
            "success": False,
            "message": f"Invalid JSON payload: {ex}",
        }))
        return

    try:
        execution_info = _run_pipeline(payload)
    except Exception as ex:
        print(json.dumps({
            "success": False,
            "message": f"MOGONET preprocessing failed: {ex}",
        }))
        return

    response = {
        "success": True,
        "message": "MOGONET-style preprocessing executed successfully.",
        "data": {
            **execution_info,
            "receivedAt": datetime.utcnow().isoformat() + "Z",
            "analysisId": payload.get("analysisId"),
            "selectedIllnessColumn": payload.get("selectedIllnessColumn"),
            "selectedSampleColumn": payload.get("selectedSampleColumn"),
            "selectedIllnessColumns": _collect_selected_columns(payload, "selectedIllnessColumn", "selectedIllnessColumns"),
            "selectedSampleColumns": _collect_selected_columns(payload, "selectedSampleColumn", "selectedSampleColumns"),
            "selectedProtectedColumns": _collect_selected_columns(payload, "selectedProtectedColumn", "selectedProtectedColumns"),
            "requestedSteps": ["mogonetPreprocess"],
        },
    }

    print(json.dumps(response))


if __name__ == "__main__":
    main()

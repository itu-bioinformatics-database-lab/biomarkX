import pandas as pd
import numpy as np
import os
import json
from modules.logger import logging

def feature_rank(top_features: dict = None,
                 num_top_features: int = 20,
                 feature_type: str = None,
                 outdir: str = "outputs",   
                 aggregation: str = "rrf",
                 aggregation_weights: dict = None,
                 rrf_k: int = 60,
                 subdir_label: str = ""):
    """
    Ranks features based on their importance scores from different methods (e.g., SHAP, ANOVA), aggregates 
    the scores, and selects the top N features. The ranked features are saved to a CSV file.

    Args:
        top_features (dict): A dictionary containing feature importance scores from class pairs and different methods.
        num_top_features (int): The number of top features to select and return.
        feature_type (str): The type of features being ranked (e.g., 'microRNA').
        outdir (str): The output directory where the ranked features CSV will be saved.
        aggregation (str): Aggregation method to combine ranks/weights.
                   Rank-based: {"rrf", "rank_product", "weighted_borda", "sum", "median_rank", "min_rank", "mra", "stuart", "rra"}.
                   Weight-based: {"mean_weight", "median_weight", "max_weight", "geometric_mean_weight", "ta"}.
                           Default is "rrf" (Reciprocal Rank Fusion).
        aggregation_weights (dict): Optional weights for methods when aggregation == "weighted_borda". Keys should match
                                    method names (case-insensitive). Values are floats. Defaults to 1.0 when missing.
        rrf_k (int): Constant k for RRF scoring (score = sum(1/(k + rank))). Default 60.
        subdir_label (str): Optional label to write results under a subfolder
                            (e.g., "model=xgbclassifier" or "method=statistical_tests").
                            When provided, the canonical CSV will NOT be overwritten; instead,
                            the ranked CSV is saved under
                            <outdir>/feature_ranking/<class_pair>/<safe_label>/ranked_features_df.csv.

    Returns:
        list: A list of the top N ranked features.
    """
    
    # Prepare ranking data 
    def rank_dict(d):
        # Check if d is a dictionary
        if not isinstance(d, dict):
            logging.error(f"Expected a dictionary but got {type(d).__name__} instead. Value: {d}")
            # Return empty dict to avoid breaking the process, but log the error
            return {}

        # If values are numeric, we can rank directly
        try:
            if all(isinstance(v, (int, float, np.number)) for v in d.values()):
                sorted_keys = sorted(d, key=d.get, reverse=True)
                return {key: rank + 1 for rank, key in enumerate(sorted_keys)}
        except Exception:
            # Fall through to nested handling
            pass

        # If values are dicts (e.g., method -> {feature -> score}), aggregate to a single score per feature
        # Weighted mean across sub-methods for each feature using aggregation_weights (e.g., {"shap":1.5,"lime":0.5})
        if any(isinstance(v, dict) for v in d.values()):
            feature_scores: dict = {}
            feature_weight_sums: dict = {}

            # Build sub-method weights map from aggregation_weights if provided
            method_weights = {}
            if isinstance(aggregation_weights, dict):
                try:
                    method_weights = {
                        str(k).lower(): float(v)
                        for k, v in aggregation_weights.items()
                        if isinstance(v, (int, float, np.number)) and np.isfinite(v)
                    }
                except Exception:
                    method_weights = {}

            for sub_method, feature_to_score in d.items():
                if not isinstance(feature_to_score, dict):
                    continue
                w = method_weights.get(str(sub_method).lower(), 1.0)
                if not np.isfinite(w) or w <= 0:
                    w = 1.0
                for feature, score in feature_to_score.items():
                    if isinstance(score, (int, float, np.number)) and np.isfinite(score):
                        feature_scores[feature] = feature_scores.get(feature, 0.0) + w * float(score)
                        feature_weight_sums[feature] = feature_weight_sums.get(feature, 0.0) + w

            # Compute weighted mean scores
            aggregated = {
                f: (feature_scores[f] / feature_weight_sums[f])
                for f in feature_scores if feature_weight_sums.get(f, 0.0) > 0
            }
            if not aggregated:
                logging.warning("Nested dict detected but no numeric scores found during aggregation.")
                return {}
            sorted_keys = sorted(aggregated, key=aggregated.get, reverse=True)
            return {key: rank + 1 for rank, key in enumerate(sorted_keys)}

        # Otherwise, cannot rank
        logging.error("Unsupported structure for ranking: expected numeric values or dicts of numeric values.")
        return {}

    logging.info("Performing Feature Selection by Feature Ranking")
    
    # First, create a main list for all class pairs
    all_top_features = {}
    
    # Process each class pair
    for class_pair, analysis_data in top_features.items():
        # Data type check
        if not isinstance(analysis_data, dict):
            logging.error(f"Class pair '{class_pair}': Expected dictionary but got {type(analysis_data).__name__}")
            continue  # Skip this class pair
            
        # Apply ranking to each sub-dictionary
        ranked_data = {}
        # Keep raw importance values (continuous) in parallel so we can support weight-based
        # aggregation methods (e.g., mean_weight) without losing magnitude information.
        raw_score_data = {}
        for outer_key, outer_dict in analysis_data.items():
            # Data type check
            if not isinstance(outer_dict, dict):
                logging.error(f"Class pair '{class_pair}', analysis '{outer_key}': Expected dictionary but got {type(outer_dict).__name__}")
                continue  # Skip this analysis

            # If values are numeric -> one column per outer_key
            try:
                if all(isinstance(v, (int, float, np.number)) for v in outer_dict.values()):
                    ranked_data[outer_key] = rank_dict(outer_dict)
                    # Store absolute value as "importance magnitude" (handles signed coefficients/importances)
                    raw_score_data[outer_key] = {
                        f: abs(float(s))
                        for f, s in outer_dict.items()
                        if isinstance(s, (int, float, np.number)) and np.isfinite(s)
                    }
                    continue
            except Exception:
                pass

            # If nested dict (e.g., model -> { shap: {...}, lime: {...} }) -> separate columns per sub-method
            any_nested = any(isinstance(v, dict) for v in outer_dict.values())
            if any_nested:
                for sub_method, feat_scores in outer_dict.items():
                    if not isinstance(feat_scores, dict):
                        continue
                    # Rank per sub-method independently
                    col_name = f"{outer_key} + {sub_method}"
                    ranked_data[col_name] = rank_dict(feat_scores)
                    raw_score_data[col_name] = {
                        f: abs(float(s))
                        for f, s in feat_scores.items()
                        if isinstance(s, (int, float, np.number)) and np.isfinite(s)
                    }
                continue

            # Fallback
            ranked_data[outer_key] = rank_dict(outer_dict)
            
        # Skip this class pair if no valid analysis
        if not ranked_data:
            logging.warning(f"No valid analysis data found for class pair '{class_pair}'")
            continue
            
        ranked_data_df = pd.DataFrame(ranked_data)

        # Decide aggregation early so we can handle missing ranks appropriately.
        # NOTE: RRA is explicitly robust to noise/missing values; it should not require a feature
        # to exist in every list. For other aggregations we keep the legacy behavior.
        env_agg = os.getenv("FEATURE_RANK_AGGREGATION")
        selected_agg = (aggregation or (env_agg if env_agg else "rrf")).lower()

        if selected_agg in [
            "rra",
            "robust_rank_aggregation",
            "robustrankaggregation",
            "mean_weight",
            "meanweight",
            "mean-weight",
            "median_weight",
            "medianweight",
            "median-weight",
            "max_weight",
            "maxweight",
            "max-weight",
            "geometric_mean_weight",
            "geometricmeanweight",
            "geometric-mean-weight",
            "ta",
            "threshold_algorithm",
            "thresholdalgorithm",
            "threshold_algo",
            "thresholdalgo",
        ]:
            # Keep rows even if some rank columns are missing (NaN). We'll treat missing as worst later.
            ranked_data_df = ranked_data_df.reset_index().rename(columns={"index": feature_type})
        else:
            # ANOVA features with many NaN values were filtered off due to high p-values, so we remove them
            ranked_data_df = ranked_data_df.dropna().reset_index().rename(columns={"index": feature_type})
        
        # Always compute classic overall score (sum of ranks) for backward compatibility and reporting
        rank_cols = ranked_data_df.columns[1:]
        ranked_data_df["overall score"] = ranked_data_df[rank_cols].sum(axis=1)

        # Choose aggregation method for ordering (do not persist extra score columns into CSV to avoid
        # affecting downstream mean-rank visualizations)
        # Allow environment overrides if caller does not explicitly pass aggregation settings
        if not aggregation and env_agg:
            aggregation = env_agg
        # weights can be provided via env as JSON string
        if aggregation_weights is None:
            env_weights = os.getenv("FEATURE_RANK_WEIGHTS")
            if env_weights:
                try:
                    aggregation_weights = json.loads(env_weights)
                except Exception:
                    aggregation_weights = None
        # rrf_k can be provided via env
        try:
            env_rrf_k = int(os.getenv("FEATURE_RANK_RRF_K", str(rrf_k)))
            rrf_k = env_rrf_k
        except Exception:
            pass

        agg = (aggregation or "rrf").lower()
        ranked_for_output = ranked_data_df

        try:
            if agg == "rrf":
                # Higher is better
                rrf_score = (1.0 / (rrf_k + ranked_data_df[rank_cols])).sum(axis=1)
                ranked_for_output = ranked_data_df.assign(_score=rrf_score).sort_values(by="_score", ascending=False).drop(columns=["_score"]) 
            elif agg == "rank_product":
                # Lower is better
                ranks = ranked_data_df[rank_cols].astype(float)
                rank_product = np.exp(np.log(ranks).mean(axis=1))
                ranked_for_output = ranked_data_df.assign(_score=rank_product).sort_values(by="_score", ascending=True).drop(columns=["_score"]) 
            elif agg == "weighted_borda":
                # Lower is better (weighted sum of ranks)
                # Support both exact column name weights and generic method tokens like 'shap', 'lime', 'anova', 't_test'
                weights_map = {str(k).lower(): float(v) for k, v in (aggregation_weights or {}).items() if isinstance(v, (int, float, np.number))}
                def weight_for(col: str) -> float:
                    name = str(col).lower()
                    if name in weights_map:
                        return weights_map[name]
                    # generic method tokens
                    for token in ["shap", "lime", "anova", "t_test", "ttest", "t-test"]:
                        if token in name and token in weights_map:
                            return weights_map[token]
                    return 1.0
                w = np.array([weight_for(c) for c in rank_cols], dtype=float)
                weighted_borda = (ranked_data_df[rank_cols] * w).sum(axis=1)
                ranked_for_output = ranked_data_df.assign(_score=weighted_borda).sort_values(by="_score", ascending=True).drop(columns=["_score"]) 
            elif agg in ["median_rank", "median", "medianrank"]:
                # Lower is better
                # Median Rank reduces outlier influence:
                # - odd number of inputs -> middle
                # - even number -> mean of the middle two
                ranks = ranked_data_df[rank_cols].apply(pd.to_numeric, errors='coerce')
                ranked_data_df["overall score"] = ranks.median(axis=1, skipna=True)
                ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
            elif agg in ["min_rank", "minimum_rank", "minimum", "best_rank", "bestrank", "min"]:
                # Lower is better
                # Minimum (Best) Rank: take the best (lowest) rank among all analyses for each feature.
                ranks = ranked_data_df[rank_cols].apply(pd.to_numeric, errors='coerce')
                ranked_data_df["overall score"] = ranks.min(axis=1, skipna=True)
                ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
            elif agg in ["mra", "median_rank_algorithm", "median_rank_algo", "mra_iterative"]:
                # Median Rank Algorithm (MRA) - Iterative consensus aggregation.
                # Goal: produce a consensus ranking that is "closest" to all input rankers, i.e.
                # maximize Kendall-style agreement between the consensus and individual rankings.
                #
                # Practical implementation:
                # - Start from Median Rank ordering.
                # - Build a pairwise agreement matrix w[i,j] = #rankers preferring i over j.
                # - Iteratively apply adjacent swaps to improve pairwise agreement.
                ranks_df = ranked_data_df[rank_cols].apply(pd.to_numeric, errors='coerce')
                n_features = int(ranks_df.shape[0])
                n_rankers = int(ranks_df.shape[1])

                # Guard: if too large, fall back to Median Rank for performance/memory.
                if n_features > 500 or n_rankers <= 0:
                    ranked_data_df["overall score"] = ranks_df.median(axis=1, skipna=True)
                    ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
                else:
                    ranks = ranks_df.to_numpy(dtype=float, copy=False)
                    # Fill any missing ranks with a large sentinel so they are treated as worst.
                    if np.isnan(ranks).any():
                        max_rank = np.nanmax(ranks)
                        if not np.isfinite(max_rank):
                            max_rank = float(n_features) + 1.0
                        ranks = np.where(np.isnan(ranks), max_rank + 1000.0, ranks)

                    # Initial order: Median Rank
                    med = np.median(ranks, axis=1)
                    order = np.argsort(med, kind='mergesort')

                    # Pairwise agreement counts: w[i,j] = #rankers where rank_i < rank_j
                    # (vectorized; O(n^2 * m) but constrained by n<=500)
                    w = np.zeros((n_features, n_features), dtype=np.int16)
                    for col_idx in range(n_rankers):
                        col = ranks[:, col_idx]
                        w += (col[:, None] < col[None, :]).astype(np.int16)
                    np.fill_diagonal(w, 0)

                    # Iterative adjacent swapping: swap if it improves agreement.
                    # This is a fast local search that increases the total Kemeny score.
                    max_passes = min(50, n_features)
                    for _ in range(max_passes):
                        swapped = False
                        for i in range(n_features - 1):
                            a = int(order[i])
                            b = int(order[i + 1])
                            wab = int(w[a, b])
                            wba = int(w[b, a])
                            if (wba > wab) or (wba == wab and med[b] < med[a]):
                                order[i], order[i + 1] = order[i + 1], order[i]
                                swapped = True
                        if not swapped:
                            break

                    consensus_rank = np.empty(n_features, dtype=int)
                    consensus_rank[order] = np.arange(1, n_features + 1)
                    ranked_for_output = ranked_data_df.assign(**{"overall score": consensus_rank}).iloc[order]
            elif agg in ["stuart", "stuart_rank_aggregation"]:
                # Stuart Rank Aggregation (probabilistic order-statistics based).
                # Matches the classic step-by-step description:
                #   1) Normalize each rank r to u = r / N (u in (0,1])
                #   2) For each feature, sort its k normalized ranks u_(1..k)
                #   3) Compute order-statistics probability under null (uniform ranks), via Beta CDF
                #   4) Convert to a p-value-like score; lower is better; sort ascending
                #
                # Note: We intentionally keep this under the explicit name "stuart" so we can later
                # add a separate "rra" method (if desired) without mixing terminology.
                ranks_df = ranked_data_df[rank_cols].apply(pd.to_numeric, errors='coerce')
                n_features = int(ranks_df.shape[0])
                n_rankers = int(ranks_df.shape[1])

                # If missing ranks exist, treat as worst.
                ranks = ranks_df.to_numpy(dtype=float, copy=False)
                if np.isnan(ranks).any():
                    max_rank = np.nanmax(ranks)
                    if not np.isfinite(max_rank):
                        max_rank = float(n_features) + 1.0
                    ranks = np.where(np.isnan(ranks), max_rank + 1000.0, ranks)

                # Normalize to (0,1] using N; clip to avoid 0/1 endpoints.
                denom = float(max(1, n_features))
                u = np.clip(ranks / denom, 1e-12, 1.0)
                u_sorted = np.sort(u, axis=1)

                try:
                    from scipy.stats import beta as _beta
                    # For each feature, compute p_k = BetaCDF(u_(k); k, m-k+1) and take min over k.
                    # Apply a simple multiple-testing adjustment over k (Bonferroni-style).
                    pvals = []
                    for k in range(1, n_rankers + 1):
                        pvals.append(_beta.cdf(u_sorted[:, k - 1], k, n_rankers - k + 1))
                    p_stack = np.vstack(pvals)  # (m, n)
                    stuart_p = np.min(p_stack, axis=0)
                    stuart_p_adj = np.minimum(1.0, float(n_rankers) * stuart_p)
                    ranked_for_output = ranked_data_df.assign(**{"overall score": stuart_p_adj}).sort_values(by="overall score", ascending=True)
                except Exception as e:
                    logging.error(f"Stuart aggregation failed; falling back to median_rank. Error: {e}")
                    ranked_data_df["overall score"] = ranks_df.median(axis=1, skipna=True)
                    ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
            elif agg in ["rra", "robust_rank_aggregation", "robustrankaggregation"]:
                # Robust Rank Aggregation (RRA)
                # Probabilistic ensemble method against a uniform null model.
                # Key property: robust to noise/missing values; a feature can be strong in a subset of lists.
                ranks_df = ranked_data_df[rank_cols].apply(pd.to_numeric, errors='coerce')
                n_features = int(ranks_df.shape[0])
                n_rankers = int(ranks_df.shape[1])

                # Drop features that are missing everywhere
                if n_rankers <= 0:
                    ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
                else:
                    row_has_any = ranks_df.notna().any(axis=1)
                    work = ranked_data_df.loc[row_has_any].copy()
                    ranks_work = ranks_df.loc[row_has_any].to_numpy(dtype=float, copy=False)

                    # Treat missing as worst (so it doesn't penalize beyond being absent)
                    max_rank = np.nanmax(ranks_work)
                    if not np.isfinite(max_rank):
                        max_rank = float(max(1, n_features)) + 1.0
                    ranks_work = np.where(np.isnan(ranks_work), max_rank + 1000.0, ranks_work)

                    denom = float(max(1, n_features))
                    u = np.clip(ranks_work / denom, 1e-12, 1.0)
                    u_sorted = np.sort(u, axis=1)

                    try:
                        from scipy.stats import beta as _beta
                        # For each feature, compute p_k = BetaCDF(u_(k); k, m-k+1) and take min over k.
                        # This focuses on the best subset of rankings and is robust to junk rankers.
                        pvals = []
                        for k in range(1, n_rankers + 1):
                            pvals.append(_beta.cdf(u_sorted[:, k - 1], k, n_rankers - k + 1))
                        p_stack = np.vstack(pvals)  # (m, n)
                        rra_p = np.min(p_stack, axis=0)
                        rra_p_adj = np.minimum(1.0, float(n_rankers) * rra_p)

                        work["overall score"] = rra_p_adj
                        ranked_for_output = work.sort_values(by="overall score", ascending=True)
                    except Exception as e:
                        logging.error(f"RRA aggregation failed; falling back to median_rank. Error: {e}")
                        work["overall score"] = ranks_df.loc[row_has_any].median(axis=1, skipna=True)
                        ranked_for_output = work.sort_values(by="overall score", ascending=True)
            elif agg == "sum":
                # Classic: sum of ranks (overall score); smaller is better
                ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
            elif agg in [
                "mean_weight",
                "meanweight",
                "mean-weight",
                "median_weight",
                "medianweight",
                "median-weight",
                "max_weight",
                "maxweight",
                "max-weight",
                "geometric_mean_weight",
                "geometricmeanweight",
                "geometric-mean-weight",
            ]:
                # Weight-based aggregation family
                # - Uses continuous importance magnitudes (not ranks)
                # - Normalizes each ranker's importance values to [0,1] via min-max
                # - Missing feature for a ranker is treated as 0 weight
                # - Aggregates across rankers with one of:
                #     * mean_weight (arithmetic mean)
                #     * median_weight (median)
                #     * max_weight (maximum)
                #     * geometric_mean_weight (geometric mean)
                # - Sorts by descending consensus score (higher is better)

                raw_scores_df = pd.DataFrame(raw_score_data)
                if raw_scores_df.shape[1] == 0:
                    ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
                else:
                    raw_scores_df = raw_scores_df.rename(columns={c: f"__w__{c}" for c in raw_scores_df.columns})
                    raw_scores_df = raw_scores_df.reset_index().rename(columns={"index": feature_type})

                    merged = ranked_data_df.merge(raw_scores_df, on=feature_type, how="left")
                    weight_cols = [c for c in merged.columns if str(c).startswith("__w__")]
                    if not weight_cols:
                        ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
                    else:
                        # Normalize each ranker's weights to [0,1]. Missing stays 0.
                        for col in weight_cols:
                            x = pd.to_numeric(merged[col], errors='coerce')
                            x = x.abs()
                            finite = x[np.isfinite(x)]
                            if finite.empty:
                                merged[col] = 0.0
                                continue
                            minv = float(finite.min())
                            maxv = float(finite.max())
                            if maxv <= minv:
                                merged[col] = x.notna().astype(float)
                            else:
                                merged[col] = (x - minv) / (maxv - minv)
                            merged[col] = pd.to_numeric(merged[col], errors='coerce').fillna(0.0)

                        if agg in ["median_weight", "medianweight", "median-weight"]:
                            merged["overall score"] = merged[weight_cols].median(axis=1)
                        elif agg in ["max_weight", "maxweight", "max-weight"]:
                            merged["overall score"] = merged[weight_cols].max(axis=1)
                        elif agg in ["geometric_mean_weight", "geometricmeanweight", "geometric-mean-weight"]:
                            eps = 1e-12
                            wmat = merged[weight_cols].to_numpy(dtype=float, copy=False)
                            merged["overall score"] = np.exp(np.mean(np.log(wmat + eps), axis=1))
                        else:
                            merged["overall score"] = merged[weight_cols].mean(axis=1)

                        ranked_for_output = merged.drop(columns=weight_cols).sort_values(by="overall score", ascending=False)
            elif agg in ["ta", "threshold_algorithm", "thresholdalgorithm", "threshold_algo", "thresholdalgo"]:
                # Threshold Algorithm (TA) - weight-based top-k selection
                # Designed to identify the top-k features efficiently by scanning sorted lists in parallel and
                # stopping early when a dynamic threshold proves no unseen item can beat the current top-k.
                #
                # In BIOMARK-X we still write a sorted CSV for consistency; TA guarantees correctness of the top-k
                # (k = num_top_features) while using the same normalized-weight scoring as Mean Weight.

                raw_scores_df = pd.DataFrame(raw_score_data)
                if raw_scores_df.shape[1] == 0:
                    ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
                else:
                    raw_scores_df = raw_scores_df.rename(columns={c: f"__w__{c}" for c in raw_scores_df.columns})
                    raw_scores_df = raw_scores_df.reset_index().rename(columns={"index": feature_type})
                    merged = ranked_data_df.merge(raw_scores_df, on=feature_type, how="left")
                    weight_cols = [c for c in merged.columns if str(c).startswith("__w__")]

                    if not weight_cols:
                        ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
                    else:
                        # Normalize each ranker's weights to [0,1]. Missing stays 0.
                        for col in weight_cols:
                            x = pd.to_numeric(merged[col], errors='coerce').abs()
                            finite = x[np.isfinite(x)]
                            if finite.empty:
                                merged[col] = 0.0
                                continue
                            minv = float(finite.min())
                            maxv = float(finite.max())
                            if maxv <= minv:
                                merged[col] = x.notna().astype(float)
                            else:
                                merged[col] = (x - minv) / (maxv - minv)
                            merged[col] = pd.to_numeric(merged[col], errors='coerce').fillna(0.0)

                        # TA selection on the normalized weights using the Mean Weight scoring function.
                        wmat = merged[weight_cols].to_numpy(dtype=float, copy=False)
                        n_features = int(wmat.shape[0])
                        n_rankers = int(wmat.shape[1])
                        k = int(max(1, min(num_top_features, n_features)))

                        # Precompute per-ranker ordering (descending by weight)
                        orderings = [np.argsort(wmat[:, j], kind='mergesort')[::-1] for j in range(n_rankers)]

                        import heapq
                        seen = set()
                        # min-heap of (score, idx) to track top-k
                        top_heap = []

                        def consider(idx: int):
                            if idx in seen:
                                return
                            seen.add(idx)
                            score = float(np.mean(wmat[idx, :]))
                            if len(top_heap) < k:
                                heapq.heappush(top_heap, (score, idx))
                            else:
                                if score > top_heap[0][0]:
                                    heapq.heapreplace(top_heap, (score, idx))

                        # Scan depth-wise
                        for t in range(n_features):
                            for j in range(n_rankers):
                                consider(int(orderings[j][t]))

                            # Dynamic threshold: maximum possible mean score for any unseen item
                            # (unseen item cannot exceed current depth's weight in any list)
                            thr = float(np.mean([wmat[int(orderings[j][t]), j] for j in range(n_rankers)]))
                            if len(top_heap) == k and top_heap[0][0] >= thr:
                                break

                        # Compute full TA score for stable CSV sorting (same scoring as TA uses)
                        merged["overall score"] = np.mean(wmat, axis=1)
                        ranked_for_output = merged.drop(columns=weight_cols).sort_values(by="overall score", ascending=False)
            else:
                # Fallback to classic
                ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
        except Exception as e:
            logging.error(f"Aggregation failed with method '{aggregation}'. Falling back to 'sum'. Error: {e}")
            ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
        
        # Create a folder for each class pair
        pair_dir = os.path.join(outdir, "feature_ranking", class_pair)
        os.makedirs(pair_dir, exist_ok=True)
        
        # Save a separate CSV file for each class pair
        if subdir_label:
            import re
            safe_label = re.sub(r'[^A-Za-z0-9._=+\-]+', '_', subdir_label)
            labeled_dir = os.path.join(pair_dir, safe_label)
            os.makedirs(labeled_dir, exist_ok=True)
            ranked_for_output.to_csv(f"{labeled_dir}/ranked_features_df.csv", index=False, sep=';', encoding='utf-8-sig')
        else:
            ranked_for_output.to_csv(f"{pair_dir}/ranked_features_df.csv", index=False, sep=';', encoding='utf-8-sig')
        
        # Note: We no longer duplicate ranked_features_df.csv at the base outdir to avoid confusion.
        # The canonical location is <outdir>/feature_ranking/<class_pair>/ranked_features_df.csv
        
        # Get top features for this class pair
        top_n_features = ranked_for_output.head(num_top_features)[feature_type].to_list()
        all_top_features[class_pair] = top_n_features
    
    # For backward compatibility, return only the first or single class pair (to not break old code)
    if len(all_top_features) > 0:
        first_class_pair = list(all_top_features.keys())[0]
        return all_top_features[first_class_pair]
    
    return []

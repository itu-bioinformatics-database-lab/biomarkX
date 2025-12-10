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
        aggregation (str): Aggregation method to combine ranks. One of {"rrf", "rank_product", "weighted_borda", "sum"}.
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
        for outer_key, outer_dict in analysis_data.items():
            # Data type check
            if not isinstance(outer_dict, dict):
                logging.error(f"Class pair '{class_pair}', analysis '{outer_key}': Expected dictionary but got {type(outer_dict).__name__}")
                continue  # Skip this analysis

            # If values are numeric -> one column per outer_key
            try:
                if all(isinstance(v, (int, float, np.number)) for v in outer_dict.values()):
                    ranked_data[outer_key] = rank_dict(outer_dict)
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
                continue

            # Fallback
            ranked_data[outer_key] = rank_dict(outer_dict)
            
        # Skip this class pair if no valid analysis
        if not ranked_data:
            logging.warning(f"No valid analysis data found for class pair '{class_pair}'")
            continue
            
        ranked_data_df = pd.DataFrame(ranked_data)
        
        # ANOVA features with many NaN values were filtered off due to high p-values, so we remove them
        ranked_data_df = ranked_data_df.dropna().reset_index().rename(columns={"index": feature_type})
        
        # Always compute classic overall score (sum of ranks) for backward compatibility and reporting
        rank_cols = ranked_data_df.columns[1:]
        ranked_data_df["overall score"] = ranked_data_df[rank_cols].sum(axis=1)

        # Choose aggregation method for ordering (do not persist extra score columns into CSV to avoid
        # affecting downstream mean-rank visualizations)
        # Allow environment overrides if caller does not explicitly pass aggregation settings
        env_agg = os.getenv("FEATURE_RANK_AGGREGATION")
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
            elif agg == "sum":
                # Classic: sum of ranks (overall score); smaller is better
                ranked_for_output = ranked_data_df.sort_values(by="overall score", ascending=True)
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

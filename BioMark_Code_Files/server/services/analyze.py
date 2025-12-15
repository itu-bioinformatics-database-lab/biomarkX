# Import required packages
import os, sys, json, argparse
import pandas as pd
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt
import warnings
import debugpy


# Add ../modules directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from modules.logger import logging
from modules.machineLearning.classification import Classification
from modules.statisticalTests.statistical_tests import StatisticalTestAnalysis
from modules.modelExplanation.model_explanation import ModelExplanationAnalysis
from modules.dataVisualization.dimensionality_reduction import Dimensionality_Reduction
from modules.feature_selection import feature_rank
from modules.utils import load_json
from modules.utils import load_table

# General Parameters

# Differential Analysis Parameters
feature_type = "microRNA"      # Feature type to analyze, used for diff analysis - for plot labels
reference_class = ""           # Reference class (currently unused)
lime_global_explanation_sample_num = 50  # Number of samples for LIME global explanations, diff analysis
shap_model_finetune = False    # Model fine-tuning for SHAP explainability analysis
lime_model_finetune = False    # Model fine-tuning for LIME explainability analysis
scoring = "f1"                 # Model evaluation metric, diff analysis
feature_importance_finetune = False  # Model fine-tuning for feature importance analysis
num_top_features = 20          # Number of top features to use in feature selection, diff analysis

# Clustering Analysis Parameters
plotter = "seaborn"            # Visualization library selection, diff analysis
dim = "3D"

# Classification Analysis Parameters
param_finetune = False         # For model hyperparameter optimization
finetune_fraction = 1.0        # Fraction of data to use for fine-tuning
save_best_model = True         # Whether to save the best performing model
standard_scaling = True        # Whether to apply standard scaling for data normalization
save_data_transformer = True   # Whether to save the data transformation model
save_label_encoder = True      # Whether to save the label encoder
verbose = True                 # Show detailed output during analysis

# Differential Analysis and Classification Analysis Parameters
test_size = 0.2                # Test set ratio for model training (0.2 for model and diff analysis, 0.3 for clustering)
n_folds = 5                    # Number of cross-validation folds (5 for model and diff analysis, 3 for clustering)

# Statistical Analysis Function
def run_statistical_analysis(data, selectedIllnessColumn, selectedSampleColumn, outdir, analyses):
    print("analyses: ", analyses)
    print("type(analyses): ", type(analyses))
    print("selectedIllnessColumn: ", selectedIllnessColumn)
    print("type(selectedIllnessColumn): ", type(selectedIllnessColumn))
    
    # Data validation: check if selectedIllnessColumn and selectedSampleColumn exist
    if selectedIllnessColumn not in data.columns:
        print(f"ERROR: Column '{selectedIllnessColumn}' not found in dataset!")
        return
        
    if selectedSampleColumn not in data.columns:
        print(f"ERROR: Column '{selectedSampleColumn}' not found in dataset!")
        return
    
    # Class_names check: at least 2 unique classes in the dataframe?
    unique_classes = data[selectedIllnessColumn].unique()
    print("Unique classes found:", unique_classes)
    
    if len(unique_classes) < 2:
        print(f"At least 2 classes are required, but only {len(unique_classes)} found. Analysis cannot proceed.")
        return
        
    # Check for missing values in class column
    if data[selectedIllnessColumn].isna().any():
        print(f"WARNING: Missing (NA/None) values found in column '{selectedIllnessColumn}'.")
        data = data.dropna(subset=[selectedIllnessColumn])
        print(f"Missing values filtered. New data shape: {data.shape}")
        
    # Process analyses parameter
    if isinstance(analyses, str):
        if ',' in analyses:
            analyses_list = analyses.split(',')
        else:
            analyses_list = [analyses]
    else:
        analyses_list = analyses
        
    analyses_list = [a.strip() for a in analyses_list if a and a.strip()]
    
    if not analyses_list:
        print("ERROR: No valid analysis specified!")
        return
        
    print("analyses_list:", analyses_list)
    
    try:
        analyzer = StatisticalTestAnalysis(
            data,
            analyses=analyses_list,
            labels_column=selectedIllnessColumn,
            reference_class=reference_class,
            sample_id_column=selectedSampleColumn,
            outdir=outdir,
            feature_type=feature_type,
            top_features_to_plot=num_top_features
        )
        analyzer.run_all_analyses()
        
        if hasattr(analyzer, 'categorical_encoding_info') and analyzer.categorical_encoding_info:
            print("DEBUG: Found categorical encoding info:", analyzer.categorical_encoding_info)
            print("CATEGORICAL_ENCODING_INFO:", json.dumps(analyzer.categorical_encoding_info))
        else:
            print("DEBUG: No categorical encoding info found")
            
    except Exception as e:
        import traceback
        print(f"ERROR: Exception occurred while running StatisticalTestAnalysis: {str(e)}")
        traceback.print_exc()

# Model Explanation Function
def run_model_explanation(data, selectedIllnessColumn, selectedSampleColumn, outdir, model_list, explanationAnalyzes):
    """Train classification model(s) to get trained models and run explanation methods."""
    # Train only to obtain models for explanation
    print("Running classification to get model for explanation.....\n")
    
    # Check if the sample column exists, if not, try "Sample ID" as fallback for merged files
    if selectedSampleColumn not in data.columns:
        print(f"WARNING: Column '{selectedSampleColumn}' not found in dataset!")
        if "Sample ID" in data.columns:
            print(f"Using 'Sample ID' instead (merged files always use 'Sample ID')")
            selectedSampleColumn = "Sample ID"
        else:
            print(f"ERROR: Neither '{selectedSampleColumn}' nor 'Sample ID' found in dataset!")
            print(f"Available columns: {data.columns.tolist()}")
            return
    
    clf = Classification(
        data=data.drop(columns=selectedSampleColumn),
        labels_column=selectedIllnessColumn,
        n_folds=n_folds, test_size=test_size,
        outdir=os.path.join(outdir, "explanation_models"),
        param_finetune=param_finetune, finetune_fraction=finetune_fraction,
        save_best_model=True, standard_scaling=standard_scaling,
        save_data_transformer=True, save_label_encoder=True,
        model_list=model_list,
        verbose=False,
        scoring=scoring,
        num_top_features=num_top_features,
        use_preprocessing=False
    )
    clf.data_transfrom()
    # Emit categorical encoding info for frontend modal if available
    try:
        if hasattr(clf, 'categorical_encoding_info') and clf.categorical_encoding_info:
            print("CATEGORICAL_ENCODING_INFO:", json.dumps(clf.categorical_encoding_info))
    except Exception:
        # Silently ignore if encoding info cannot be serialized or printed
        pass
    trained_models_info, preprocessor = clf.initiate_model_trainer(return_models=True)
    print("\nRunning EXPLANATION methods.....\n")
    explanation_runner = ModelExplanationAnalysis(
        X_data = clf.X,  # <-- Hazır remapped X verisi
        y_data = clf.y,  # <-- Hazır encoded y verisi
        class_names = clf.class_names, # <-- Hazır sınıf isimleri
        feature_map_reverse = clf.feature_map_reverse, # <-- Doğru harita
        analyses=explanationAnalyzes,
        labels_column=selectedIllnessColumn,
        sample_id_column=selectedSampleColumn,
        outdir=outdir,
        feature_type=feature_type,
        test_size=test_size,
        lime_global_explanation_sample_num=lime_global_explanation_sample_num,
        shap_model_finetune=shap_model_finetune,
        lime_model_finetune=lime_model_finetune,
        n_folds=n_folds,
        scoring=scoring,
        top_features_to_plot=num_top_features,
        feature_importance_finetune=feature_importance_finetune,
        trained_models_info=trained_models_info,
        preprocessor=preprocessor,
        X_test=clf.X_test_raw,
        y_test=clf.y_test
    )
    explanation_runner.run_all_analyses()

# Initial Visualization Function
def initial_visualization(data, visualizations, outdir, selectedSampleColumn, selectedIllnessColumn):
    print("visualizations: ", visualizations)
    if visualizations and visualizations != ['']:
        dim_visualizer = Dimensionality_Reduction(data=data.drop(columns=selectedSampleColumn),
                                                labels_column=selectedIllnessColumn,
                                                plotter=plotter,
                                                outdir=os.path.join(outdir, "initial"))
        dim_visualizer.runPlots(runs=visualizations)
        
        # Return categorical encoding information for frontend
        if hasattr(dim_visualizer, 'categorical_encoding_info') and dim_visualizer.categorical_encoding_info:
            print("DEBUG: Found categorical encoding info in visualization:", dim_visualizer.categorical_encoding_info)
            print("CATEGORICAL_ENCODING_INFO:", json.dumps(dim_visualizer.categorical_encoding_info))
        else:
            print("DEBUG: No categorical encoding info found in visualization")

# Initial Model Training Function
def initial_model_training(data, selectedIllnessColumn, selectedSampleColumn, outdir, model_list):
    print("model_list: ", model_list)
    if model_list and model_list != ['']:
        clf = Classification(
            data=data.drop(columns=selectedSampleColumn),
            labels_column=selectedIllnessColumn,
            n_folds=n_folds,
            test_size=test_size,
            outdir=os.path.join(outdir, "initial"),
            param_finetune=param_finetune,
            finetune_fraction = finetune_fraction,
            save_best_model = save_best_model,
            standard_scaling = standard_scaling,
            save_data_transformer = save_data_transformer,
            save_label_encoder = save_label_encoder,            
            model_list=model_list,
            verbose=verbose,
            scoring=scoring,
            num_top_features=num_top_features,
            use_preprocessing=False
        )
        clf.data_transfrom()
        # Emit categorical encoding info for frontend modal if available
        try:
            if hasattr(clf, 'categorical_encoding_info') and clf.categorical_encoding_info:
                print("CATEGORICAL_ENCODING_INFO:", json.dumps(clf.categorical_encoding_info))
        except Exception:
            # Silently ignore if encoding info cannot be serialized or printed
            pass
        clf.initiate_model_trainer()

# Feature Selection Function (class-pair aware)
def feature_selection(outdir, class_pair: str):
    """Return top ranked features for the given class pair if available.

    Parameters
    ----------
    outdir : str
        Directory that contains ``feature_importances.json``.
    class_pair : str
        Target class pair key in the form "ClassA_ClassB" (case-sensitive, depends on previous save).

    Returns
    -------
    list | None
        List of top ``num_top_features`` features for the given class pair or ``None``
        if the class pair does not exist in the file.
    """

    # Load saved feature importances
    feature_importances_path = os.path.join(outdir, "feature_importances.json")
    feature_importances = load_json(feature_importances_path)

    if not feature_importances or not isinstance(feature_importances, dict):
        return None

    # Try both possible key orders (e.g. A_B and B_A)
    possible_keys = [class_pair]
    if "_" in class_pair:
        cls1, cls2 = class_pair.split("_", 1)
        possible_keys.append(f"{cls2}_{cls1}")

    selected_key = next((k for k in possible_keys if k in feature_importances), None)
    if not selected_key:
        # No differential analysis for this class pair
        return None

    # Use only the selected class pair data for ranking
    filtered_importances = {selected_key: feature_importances[selected_key]}

    top_n = feature_rank(top_features=filtered_importances,
                         num_top_features=num_top_features,
                         feature_type=feature_type,
                         outdir=outdir)

    return top_n

# After Feature Selection Visualization Function
def visualization_after_feature_selection(data, visualizations, outdir, selectedIllnessColumn):
    if(visualizations != ['']):
        dim_visualizer = Dimensionality_Reduction(data,
                                                labels_column=selectedIllnessColumn,
                                                plotter=plotter,
                                                outdir=os.path.join(outdir, "AfterFeatureSelection"))
        dim_visualizer.runPlots(runs=visualizations)

# After Feature Selection Model Training Function
def model_training_after_feature_selection(data, selectedIllnessColumn, outdir, model_list):
    if model_list and model_list != ['']:
        clf = Classification(
            data=data,
            labels_column=selectedIllnessColumn,
            n_folds=n_folds,
            test_size=test_size,
            outdir=os.path.join(outdir, "AfterFeatureSelection"),
            param_finetune=param_finetune,
            finetune_fraction = finetune_fraction,
            save_best_model = save_best_model,
            standard_scaling = standard_scaling,
            save_data_transformer = save_data_transformer,
            save_label_encoder = save_label_encoder,
            model_list=model_list,
            verbose=verbose,
            num_top_features=num_top_features,
            use_preprocessing=False
        )
        clf.data_transfrom()
        clf.initiate_model_trainer()

# Main script execution
if __name__ == "__main__":
    # Set up command line arguments
    parser = argparse.ArgumentParser(description='Parameters for biomarker analysis')
    parser.add_argument('data_path', help='Path to the data file')
    parser.add_argument('selectedIllnessColumn', help='Name of the illness column')
    parser.add_argument('selectedSampleColumn', help='Name of the sample column')
    parser.add_argument('selectedClasseses', help='Selected classes')
    parser.add_argument('differentialAnalyzes', help='Differential analysis methods')
    parser.add_argument('clusteringAnalyzes', help='Clustering analysis methods')
    parser.add_argument('classificationAnalyzes', help='Classification analysis methods')
    parser.add_argument('explanationAnalyzes', help='Explanation analysis methods')
    parser.add_argument('nonFeatureColumns', help='Non-feature columns')
    parser.add_argument('isDiffAnalysis', help='Whether to perform differential analysis')
    parser.add_argument('afterFeatureSelection', help='Whether to perform analysis after feature selection')
    parser.add_argument('--params', help='Parameter settings (in JSON format)', default='{}')

    args = parser.parse_args()
    
    # Extract arguments
    data_path = args.data_path
    selectedIllnessColumn = args.selectedIllnessColumn
    selectedSampleColumn = args.selectedSampleColumn
    selectedClasseses = [cls for cls in args.selectedClasseses.split(',')] if args.selectedClasseses else []
    
    # Process analysis arguments safely
    def process_arg(arg):
        if not arg:
            return []
        # Standardize format and split
        return [item.strip() for item in arg.lower().replace('-', '_').split(",") if item.strip()]

    statistical_tests = process_arg(args.differentialAnalyzes)  # legacy arg name, now statistical tests
    dimensionality_reduction = process_arg(args.clusteringAnalyzes)
    classification_methods = process_arg(args.classificationAnalyzes)
    explanation_methods = process_arg(args.explanationAnalyzes)
    nonFeatureColumns = process_arg(args.nonFeatureColumns)
    selected_diff_analyses = process_arg(args.isDiffAnalysis)
    afterFeatureSelection = args.afterFeatureSelection.lower() == 'true'

    # Ensure explanation methods are not run twice if they are also in the statistical list
    if explanation_methods:
        statistical_tests = [item for item in statistical_tests if item not in explanation_methods]
        # Also remove from selected_diff_analyses to prevent double runs from older logic paths
        selected_diff_analyses = [item for item in selected_diff_analyses if item not in explanation_methods]

    # Load parameter settings in JSON format
    params_json = {}
    if args.params and args.params != '{}':
        try:
            params_json = json.loads(args.params)
            
            # First check and update dim parameter
            if "dim" in params_json:
                globals()["dim"] = params_json["dim"]
                print(f"dim parameter updated: {dim}")
        except Exception as e:
            print(f"Error parsing parameter JSON: {e}")
    
    # Add dim variable to clusteringAnalyzes argument (e.g., 2d_ or 3d_)
    if dimensionality_reduction:
        dim_prefix = dim.lower() + "_" if dim else ""
        dimensionality_reduction = [dim_prefix + analysis for analysis in dimensionality_reduction]
    else:
        dimensionality_reduction = []
    
    # Update other parameters
    if params_json:
        try:
            # Update Differential Analysis Parameters
            if "feature_type" in params_json:
                globals()["feature_type"] = params_json["feature_type"]
            if "reference_class" in params_json:
                globals()["reference_class"] = params_json["reference_class"]
            if "lime_global_explanation_sample_num" in params_json:
                globals()["lime_global_explanation_sample_num"] = params_json["lime_global_explanation_sample_num"]
            if "shap_model_finetune" in params_json:
                globals()["shap_model_finetune"] = params_json["shap_model_finetune"]
            if "lime_model_finetune" in params_json:
                globals()["lime_model_finetune"] = params_json["lime_model_finetune"]
            if "scoring" in params_json:
                globals()["scoring"] = params_json["scoring"]
            if "feature_importance_finetune" in params_json:
                globals()["feature_importance_finetune"] = params_json["feature_importance_finetune"]
            if "num_top_features" in params_json:
                globals()["num_top_features"] = params_json["num_top_features"]
            
            # Update Clustering Analysis Parameters
            if "plotter" in params_json:
                globals()["plotter"] = params_json["plotter"]
            # (dim parameter updated above)
            
            # Update Classification Analysis Parameters
            if "param_finetune" in params_json:
                globals()["param_finetune"] = params_json["param_finetune"]
            if "finetune_fraction" in params_json:
                globals()["finetune_fraction"] = params_json["finetune_fraction"]
            if "save_best_model" in params_json:
                globals()["save_best_model"] = params_json["save_best_model"]
            if "standard_scaling" in params_json:
                globals()["standard_scaling"] = params_json["standard_scaling"]
            if "save_data_transformer" in params_json:
                globals()["save_data_transformer"] = params_json["save_data_transformer"]
            if "save_label_encoder" in params_json:
                globals()["save_label_encoder"] = params_json["save_label_encoder"]
            if "verbose" in params_json:
                globals()["verbose"] = params_json["verbose"]
            if "use_preprocessing" in params_json:
                globals()["use_preprocessing"] = params_json["use_preprocessing"]
            
            # Update Common Parameters
            if "test_size" in params_json:
                globals()["test_size"] = params_json["test_size"]
            if "n_folds" in params_json:
                globals()["n_folds"] = params_json["n_folds"]
            # Aggregation parameters moved to final results combine step (no env injection here)
                
        except Exception as e:
            print(f"Error loading parameter settings: {e}")
    
    # Print parameters
    """ print("Data Path:", data_path)
    print("Selected Illness Column:", selectedIllnessColumn)
    print("Selected Sample Column:", selectedSampleColumn)
    print("Selected Classes:", selectedClasseses)
    print("Statistical Tests:", statistical_tests)
    print("Dimensionality Reduction:", dimensionality_reduction)
    print("Classification Analyses:", classification_methods)
    print("Model Explanation:", explanation_methods)
    print("Non-Feature Columns:", nonFeatureColumns)
    print("Selected Differential Analyses:", selected_diff_analyses)
    print("After Feature Selection:", afterFeatureSelection) """
    
    """ # Print parameter settings
    print("\nParameter Settings:")
    print(f"feature_type: {feature_type}")
    print(f"lime_global_explanation_sample_num: {lime_global_explanation_sample_num}")
    print(f"shap_model_finetune: {shap_model_finetune}")
    print(f"lime_model_finetune: {lime_model_finetune}")
    print(f"scoring: {scoring}")
    print(f"feature_importance_finetune: {feature_importance_finetune}")
    print(f"num_top_features: {num_top_features}")
    print(f"plotter: {plotter}")
    print(f"dim: {dim}")
    print(f"param_finetune: {param_finetune}")
    print(f"finetune_fraction: {finetune_fraction}")
    print(f"save_best_model: {save_best_model}")
    print(f"standard_scaling: {standard_scaling}")
    print(f"save_data_transformer: {save_data_transformer}")
    print(f"save_label_encoder: {save_label_encoder}")
    print(f"verbose: {verbose}")
    print(f"test_size: {test_size}")
    print(f"n_folds: {n_folds}") """

    # Set analyses parameters
    # Map parsed args to variables used below
    analyses = statistical_tests
    model_list = classification_methods
    visualizations = dimensionality_reduction

    # Output directory
    base_name = os.path.basename(data_path)
    file_name_without_ext = os.path.splitext(base_name)[0]
    outdir = os.path.join("results", file_name_without_ext)
    
    # Create a unique path for this class pair analysis
    class_pair_key = f"{selectedClasseses[0]}_{selectedClasseses[1]}" if len(selectedClasseses) >= 2 else "all_classes"
    RESULTS_PATH = os.path.join(outdir, class_pair_key)
    FEATURE_RANKING_PATH = os.path.join(outdir, "feature_ranking", class_pair_key)
    os.makedirs(RESULTS_PATH, exist_ok=True)
    os.makedirs(FEATURE_RANKING_PATH, exist_ok=True)

    # Load data
    df = load_table(data_path)

    # Normalize selected classes to strings (strip whitespace)
    selected_classes_norm = [str(x).strip() for x in selectedClasseses]

    # Debug: show original DataFrame info
    print(f"Original df shape before filtering: {df.shape}")
    try:
        print(f"Sample unique values in column '{selectedIllnessColumn}':", pd.Series(df[selectedIllnessColumn].dropna().astype(str).str.strip().unique()[:50]))
    except Exception:
        # Silently ignore if debug print fails (e.g., column doesn't exist or empty dataframe)
        pass

    # Filter data for selected classes - handle multiple cell formats:
    #  - plain values (numeric or string)
    #  - list-like strings ("['1','2']")
    #  - delimited strings ("1;2" or "1,2")
    import ast

    # Precompute numeric representations of targets when possible for numeric comparison
    numeric_targets = {}
    for t in selected_classes_norm:
        try:
            numeric_targets[t] = float(t)
        except Exception:
            # Set to None if target cannot be converted to float (e.g., non-numeric string)
            numeric_targets[t] = None

    def numeric_equal(a_str, t_str):
        # compare strings a_str and t_str numerically when possible
        try:
            a_float = float(a_str)
            t_float = numeric_targets.get(t_str)
            if t_float is None:
                try:
                    t_float = float(t_str)
                except Exception:
                    # Return False if target string cannot be converted to float
                    return False
            return a_float == t_float
        except Exception:
            # Return False if numeric comparison fails (e.g., input string cannot be converted to float)
            return False

    def cell_matches(cell_val, targets):
        # Return True if cell_val (various formats) contains any of targets
        if pd.isna(cell_val):
            return False
        s = str(cell_val).strip()
        # try to parse python literal lists/tuples
        if s.startswith('[') and s.endswith(']'):
            try:
                parsed = ast.literal_eval(s)
                if isinstance(parsed, (list, tuple, set)):
                    for item in parsed:
                        item_s = str(item).strip()
                        if item_s in targets:
                            return True
                        # numeric compare
                        for t in targets:
                            if numeric_equal(item_s, t):
                                return True
            except Exception:
                # Silently ignore if list parsing fails (e.g., malformed list-like string)
                pass
        # check common delimiters
        for delim in [',', ';', '|', '/']:
            if delim in s:
                parts = [p.strip() for p in s.split(delim) if p.strip()]
                for p in parts:
                    if p in targets:
                        return True
                    for t in targets:
                        if numeric_equal(p, t):
                            return True
        # fallback to direct match or numeric equality
        if s in targets:
            return True
        for t in targets:
            if numeric_equal(s, t):
                return True
        return False

    print(f"Filtering by selected classes (stringified): {selected_classes_norm}")
    mask = df[selectedIllnessColumn].apply(lambda v: cell_matches(v, selected_classes_norm))
    print(f"Rows matching selected classes: {mask.sum()} / {len(mask)}")
    df = df[mask]

    """ Data Preparation for Analysis """
    # Check column names and find matching columns
    valid_columns = []
    for col in nonFeatureColumns:
        # Convert to uppercase and check
        upper_col = col.upper()
        # Check for exact match
        if upper_col in df.columns:
            valid_columns.append(upper_col)
        else:
            # Case-insensitive match
            for df_col in df.columns:
                if upper_col == df_col.upper():
                    valid_columns.append(df_col)
                    break
    
    # Drop matching columns from dataframe
    data = df.drop(columns=valid_columns).reset_index(drop=True)
    # Ensure feature dtypes are acceptable for XGBoost: int/float/bool/category
    obj_cols = data.select_dtypes(include=['object']).columns.tolist()
    if obj_cols:
        print(f"Converting object-typed feature columns: {obj_cols}")
        for col in obj_cols:
            # skip the label column if present (shouldn't be in data here)
            if col == selectedIllnessColumn or col == selectedSampleColumn:
                continue
            # try numeric conversion
            coerced = pd.to_numeric(data[col], errors='coerce')
            if coerced.notna().sum() > 0 and coerced.isna().sum() < len(coerced):
                # If a reasonable number converted, use numeric with median imputation for NaNs
                med = coerced.median()
                data[col] = coerced.fillna(med)
                print(f"Column {col}: converted to numeric with median imputation (median={med})")
            else:
                # fallback: convert to categorical then use integer codes so XGBoost gets numeric dtype
                s = data[col].astype('category')
                try:
                    mode_val = s.mode(dropna=True).iloc[0]
                    s = s.fillna(mode_val)
                except Exception:
                    # if no mode, fill with empty string category
                    s = s.fillna('')
                codes = s.cat.codes
                data[col] = codes
                print(f"Column {col}: converted to categorical codes (int) with {len(s.cat.categories)} categories")
    
    # Fix for merged files: if the selected sample column doesn't exist but "Sample ID" does,
    # use "Sample ID" instead (merged files always standardize to "Sample ID")
    if selectedSampleColumn not in data.columns:
        print(f"WARNING: Column '{selectedSampleColumn}' not found in dataset!")
        if "Sample ID" in data.columns:
            print(f"Using 'Sample ID' instead (merged files always use 'Sample ID')")
            selectedSampleColumn = "Sample ID"
        else:
            print(f"ERROR: Neither '{selectedSampleColumn}' nor 'Sample ID' found in dataset!")
            print(f"Available columns: {data.columns.tolist()}")
            exit(1)

    # If `afterFeatureSelection` is true, we need to perform feature selection now.
    if afterFeatureSelection:
        print("\n--- Performing Feature Selection ---")
        
        # We need the class pair to find the correct ranked features file.
        if len(selectedClasseses) >= 2:
            class_pair_key = f"{selectedClasseses[0]}_{selectedClasseses[1]}"
            
            # This function loads feature_importances.json, ranks them using feature_rank,
            # and returns the top N features.
            top_features = feature_selection(outdir, class_pair=class_pair_key)
            
            if top_features:
                print(f"Top {len(top_features)} features selected for class pair '{class_pair_key}'.")
                
                # The columns to keep are the selected features plus the essential metadata columns.
                columns_to_keep = top_features + [selectedIllnessColumn, selectedSampleColumn]
                
                # Filter the dataframe to keep only these columns.
                # Ensure we only select columns that actually exist in the dataframe to prevent errors.
                existing_columns_to_keep = [col for col in columns_to_keep if col in data.columns]
                data = data[existing_columns_to_keep]
                
                print("Data shape after feature selection:", data.shape)
            else:
                print(f"Warning: No top features found for class pair '{class_pair_key}'. Proceeding with all features.")
        else:
            print("Warning: At least two classes are required for feature selection. Proceeding with all features.")

    # Run statistical analysis
    if analyses:
        print("\nrun_statistical_analysis function for STATISTICAL TESTS.....\n")
        run_statistical_analysis(data, selectedIllnessColumn, selectedSampleColumn, RESULTS_PATH, analyses)
    
    # Visualization (branch by afterFeatureSelection)
    if visualizations:
        if afterFeatureSelection:
            print("visualization_after_feature_selection function.....\n")
            visualization_after_feature_selection(
                data.drop(columns=selectedSampleColumn),
                visualizations,
                RESULTS_PATH,
                selectedIllnessColumn
            )
        else:
            print("initial_visualization function.....\n")
            initial_visualization(
                data,
                visualizations,
                RESULTS_PATH,
                selectedSampleColumn,
                selectedIllnessColumn
            )
    
    # Handle Classification and Explanation
    if model_list:
        if explanation_methods:
            run_model_explanation(
                data=data,
                selectedIllnessColumn=selectedIllnessColumn,
                selectedSampleColumn=selectedSampleColumn,
                outdir=RESULTS_PATH,
                model_list=model_list,
                explanationAnalyzes=explanation_methods
            )

        else:
            # Run classification (branch by afterFeatureSelection)
            if afterFeatureSelection:
                print("model_training_after_feature_selection function for CLASSIFICATION.....\n")
                model_training_after_feature_selection(
                    data.drop(columns=selectedSampleColumn),
                    selectedIllnessColumn,
                    RESULTS_PATH,
                    model_list
                )
            else:
                print("initial_model_training function for CLASSIFICATION.....\n")
                initial_model_training(
                    data,
                    selectedIllnessColumn,
                    selectedSampleColumn,
                    RESULTS_PATH,
                    model_list
                )

    exit()
# General
import os
import pandas as pd
import numpy as np
from sklearn.preprocessing import LabelEncoder, OrdinalEncoder
from sklearn.model_selection import train_test_split
from sklearn import set_config

# Visualization
import seaborn as sns

# Custom analysis modules
from modules.modelExplanation.shap_analysis import SHAP_Analysis
from modules.modelExplanation.lime_analysis import LIME_Analysis
from modules.modelExplanation.feature_importance_analysis import FeatureImportance_Analysis
from modules.logger import logging
from modules.feature_selection import feature_rank


set_config(transform_output="pandas")


class ModelExplanationAnalysis:
    """
    Model explanation runner for SHAP, LIME and Permutation Feature Importance.
    Accepts pre-trained model info dict (trained_models_info) to avoid retraining.
    """

    def __init__(self,
                 X_data=None,
                 y_data=None,
                 class_names=None,
                 feature_map_reverse=None,
                 analyses=None,
                 labels_column: str = "Diagnosis",
                 sample_id_column: str = "Sample ID",
                 outdir: str = "output",
                 feature_type: str = "microRNA",
                 test_size: float = 0.2,
                 lime_global_explanation_sample_num: int = 10,
                 shap_model_finetune: bool = False,
                 lime_model_finetune: bool = False,
                 n_folds: int = 5,
                 scoring: str = "f1",
                 top_features_to_plot: int = 20,
                 feature_importance_finetune: bool = False,
                 trained_models_info: dict = None,
                 preprocessor: object = None,
                 X_test: pd.DataFrame = None,
                 y_test: np.ndarray = None):

        sns.set_theme(style="darkgrid")
        self.X = X_data
        self.y = y_data
        # Ensure class_names are strings to avoid join/formatting errors with numpy types
        self.class_names = [str(c) for c in class_names] if class_names else class_names
        self.feature_map_reverse = feature_map_reverse
        self.outdir = outdir
        self.feature_type = feature_type
        self.top_features_to_plot = top_features_to_plot
        self.analyses = analyses or ["shap", "lime", "permutation_feature_importance"]
        self.trained_models_info = trained_models_info
        self.preprocessor = preprocessor
        self.X_test = X_test
        self.y_test = y_test
        self.feature_importance_finetune = feature_importance_finetune
        # Determine model key for namespacing outputs
        try:
            self.model_key = list(self.trained_models_info.keys())[0] if self.trained_models_info else "unknown_model"
        except Exception:
            self.model_key = "unknown_model"
        # Random samples — support any number of classes
        np.random.seed(42)
        self.random_samples = {}
        for idx, name in enumerate(self.class_names):
            class_indices = np.where(self.y == idx)[0]
            if len(class_indices) > 0:
                self.random_samples[name] = np.random.choice(class_indices)

        # Init analyzers
        if "shap" in self.analyses:
            self.SHAP_Analyzer = SHAP_Analysis(
                X=self.X, y=self.y, outdir=f"{self.outdir}/{self.model_key}/shap",
                random_samples=self.random_samples, feature_type=self.feature_type,
                feature_map_reverse=self.feature_map_reverse,
                model_finetune=shap_model_finetune, fine_tune_cv_nfolds=n_folds, scoring=scoring,
                top_features_to_plot=top_features_to_plot,
                class_names=self.class_names,
                trained_models_info=self.trained_models_info,
                preprocessor=self.preprocessor
            )
        else:
            self.SHAP_Analyzer = None

        if "lime" in self.analyses:
            self.LIME_Analyzer = LIME_Analysis(
                X=self.X, y=self.y, outdir=f"{self.outdir}/{self.model_key}/lime",
                class_names=self.class_names, random_samples=self.random_samples,
                feature_type=self.feature_type,
                global_explanation_sample_num=lime_global_explanation_sample_num,
                feature_map_reverse=self.feature_map_reverse,
                model_finetune=lime_model_finetune,
                fine_tune_cv_nfolds=n_folds,
                scoring=scoring,
                top_features_to_plot=top_features_to_plot,
                trained_models_info=self.trained_models_info,
                preprocessor=self.preprocessor
            )
        else:
            self.LIME_Analyzer = None

        if "permutation_feature_importance" in self.analyses:
            self.FeatureImportance_Analyzer = FeatureImportance_Analysis(
                X=self.X, y=self.y, test_size=test_size, feature_type=feature_type,
                top_features_to_plot=top_features_to_plot, feature_map_reverse=self.feature_map_reverse,
                model_finetune=self.feature_importance_finetune, fine_tune_cv_nfolds=n_folds, scoring=scoring,
                outdir=os.path.join(outdir, self.model_key), trained_models_info=self.trained_models_info, preprocessor=self.preprocessor,
                X_test=self.X_test, y_test=self.y_test
            )
        else:
            self.FeatureImportance_Analyzer = None

        # Prepare output folders (only needed ones)
        for analysis in set([a.replace('permutation_feature_importance', 'feature_importance') for a in self.analyses]):
            for subdir in ["png", "pdf"]:
                os.makedirs(
                    os.path.join(
                        self.outdir,
                        self.model_key,
                        analysis if analysis in ["shap", "lime"] else "feature_importance",
                        subdir
                    ),
                    exist_ok=True
                )

        self.top_features = {}

    def perform_shap_analysis(self):
        logging.info("Performing SHAP Analysis")
        length = 110
        print("=" * length)
        print(" Starting SHAP Waterfall Analysis ")
        print("=" * length)
        self.SHAP_Analyzer.shapWaterFall()

        print("=" * length)
        print(" Starting SHAP Force Plot Analysis ")
        print("=" * length)
        self.SHAP_Analyzer.shapForce()

        print("=" * length)
        print(" Starting SHAP Summary Plot Analysis ")
        print("=" * length)
        self.SHAP_Analyzer.shapSummary()

        print("=" * length)
        print(" Starting SHAP Heatmap Analysis ")
        print("=" * length)
        self.SHAP_Analyzer.shapHeatmap()

        print("=" * length)
        print(" Starting Mean SHAP Plot Analysis ")
        print("=" * length)
        self.SHAP_Analyzer.meanSHAP()

        print("=" * length)
        print(" Starting SHAP Feature Importance Analysis ")
        print("=" * length)
        self.top_features["shap"] = self.SHAP_Analyzer.shapFeatureImportance()
        print(sorted(self.top_features["shap"], key=self.top_features["shap"].get, reverse=True)[:self.top_features_to_plot])

        # Save SHAP feature importances to CSV for download
        try:
            # Save under model-specific SHAP directory for clarity
            shap_dir = getattr(self.SHAP_Analyzer, 'outdir', os.path.join(self.outdir, self.model_key, "shap"))
            os.makedirs(shap_dir, exist_ok=True)
            pd.DataFrame(
                list(self.top_features["shap"].items()),
                columns=["Feature", "Importance"]
            ).to_csv(os.path.join(shap_dir, "shap_feature_importance.csv"), index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        print("=" * length)
        print(" SHAP Analysis Completed ")
        print("=" * length)

    def perform_lime_analysis(self):
        logging.info("Performing LIME Analysis")
        length = 110
        print("=" * length)
        print(" Starting LIME Per Sample Explanations")
        print("=" * length)
        self.LIME_Analyzer.explain_samples()

        print("=" * length)
        print(" Starting LIME Feature Importance Analysis ")
        print("=" * length)
        self.top_features["lime"] = self.LIME_Analyzer.limeFeatureImportance()
        print(sorted(self.top_features["lime"], key=self.top_features["lime"].get, reverse=True)[:self.top_features_to_plot])

        print("=" * length)
        print(" LIME Analysis Completed ")
        print("=" * length)

    def perform_permutation_feature_importance_analysis(self):
        logging.info("Performing Permutation Feature Importance Analysis")
        length = 110
        print("=" * length)
        print(" Starting Feature Importance Analysis with Permutation Method")
        print("=" * length)

        perm_importances = self.FeatureImportance_Analyzer.PermutationFeatureImportance()
        self.top_features["permutation_feature_importance"] = perm_importances

        if perm_importances:
            import pandas as pd
            sorted_features = sorted(perm_importances.items(), key=lambda item: item[1], reverse=True)
            top_features_df = pd.DataFrame(sorted_features[:self.top_features_to_plot], columns=['Features', 'Importance Decrease'])
            print("Top Features (Permutation Importance):")
            print(top_features_df)

        print("=" * length)
        print(" Permutation Feature Importance Analysis Completed ")
        print("=" * length)

    def run_all_analyses(self):
        logging.info("RUNNING MODEL EXPLANATION ANALYSES")
        length = 110
        print("=" * length)
        print(" Starting Model Explanation Analyses ")
        print("=" * length)

        if "shap" in self.analyses and self.SHAP_Analyzer is not None:
            self.perform_shap_analysis()

        if "lime" in self.analyses and self.LIME_Analyzer is not None:
            self.perform_lime_analysis()

        if "permutation_feature_importance" in self.analyses and self.FeatureImportance_Analyzer is not None:
            self.perform_permutation_feature_importance_analysis()

        # Convert values to float for JSON serialization and save grouped by class pair
        import json
        for a in self.top_features.keys():
            for feature in self.top_features[a].keys():
                self.top_features[a][feature] = float(self.top_features[a][feature])

        # Save at base results/<file>/feature_importances.json (grouped by class pairs and model key)
        base_outdir = os.path.dirname(self.outdir)
        json_path = os.path.join(base_outdir, "feature_importances.json")
        if os.path.exists(json_path):
            with open(json_path, "r") as f:
                try:
                    existing_data = json.load(f)
                except json.JSONDecodeError:
                    existing_data = {}
        else:
            existing_data = {}

        class_pair = "_vs_".join(sorted(str(c) for c in self.class_names))
        if class_pair not in existing_data:
            existing_data[class_pair] = {}
        if self.model_key not in existing_data[class_pair]:
            existing_data[class_pair][self.model_key] = {}
        for a in self.top_features.keys():
            if a not in existing_data[class_pair][self.model_key]:
                existing_data[class_pair][self.model_key][a] = {}
            for feature, value in self.top_features[a].items():
                existing_data[class_pair][self.model_key][a][feature] = float(value)

        with open(json_path, "w") as f:
            json.dump(existing_data, f, indent=4)

        # Generate aggregated ranking CSVs using ONLY current run outputs
        # Structure: { class_pair: { analysis_name: {feature: score} } }
        try:
            filtered_for_ranking = {
                class_pair: {a: self.top_features[a] for a in self.top_features.keys()}
            }
            label_analyses = "+".join(sorted(self.top_features.keys())) if self.top_features else ""
            feature_rank(
                top_features=filtered_for_ranking,
                num_top_features=self.top_features_to_plot,
                feature_type=self.feature_type,
                outdir=base_outdir,
                subdir_label=(f"model={self.model_key},analysis={label_analyses}" if label_analyses else f"model={self.model_key}")
            )
        except Exception:
            pass

        print("=" * length)
        print(" Model Explanation Analyses Completed ")
        print("=" * length)

        # Write a concise README to clarify directory structure for this class pair
        try:
            readme_path = os.path.join(self.outdir, "README.md")
            with open(readme_path, "w", encoding="utf-8") as rf:
                rf.write(
                    "# Analysis Outputs\n\n"
                    "This folder contains model explanation outputs for the selected class pair.\n\n"
                    "- shap/: SHAP plots and `shap_feature_importance.csv`\n"
                    "- lime/: LIME plots and `lime_feature_importance.csv`\n"
                    "- feature_importance/: permutation importance CSVs per model\n"
                    "- explanation_models/: per-model evaluation plots/metrics used for explanations\n"
                    "- feature_ranking/: aggregated ranking CSVs live under `../feature_ranking/<ClassA_ClassB>/ranked_features_df.csv`\n\n"
                    "Notes:\n"
                    "- Aggregated `feature_importances.json` is saved at the parent folder and grouped by model key.\n"
                    "- The canonical ranked features CSV is only under `feature_ranking/<ClassA_ClassB>/`.\n"
                )
        except Exception:
            pass



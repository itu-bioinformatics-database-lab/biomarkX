# Load general packages
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import os
import re
import contextlib

# Load sklearn packages
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn import set_config

# Load specialized packages
import lime
import lime.lime_tabular
import itertools

# Load Custom Modules
from modules.utils import save_json, load_json, getparams
from modules.logger import logging

# Set sklearn configuration
set_config(transform_output="pandas")


class LIME_Analysis:
    """
    This class performs LIME analysis on a dataset and plots the explainability 
    of top differentiating features.

    Attributes:
    -----------
    X : pd.DataFrame, optional
        The feature matrix.
    y : pd.Series, optional
        The target variable.
    class_names : list, optional
        The names of the classes.
    mode : str, optional, default="classification"
        The mode for LIME ("classification" or "regression").
    random_samples : dict, optional
        Random samples for each class.
    outdir : str, optional, default=""
        Output directory for saving plots.
    feature_type : str, optional
        Type of feature being analyzed (e.g., continuous or categorical).
    global_explanation_sample_num : int, optional, default=10
        Number of samples for global explanations.
    feature_map_reverse : dict, optional
        Mapping of features to their original names or formats.
    model_finetune : bool, optional, default=False
        Whether to fine-tune the model for better LIME analysis.
    fine_tune_cv_nfolds : int, optional, default=5
        Number of cross-validation folds for fine-tuning.
    scoring : str, optional, default="f1"
        Scoring metric used for fine-tuning the model.
    top_features_to_plot : int, optional, default=20
        The number of features to display per plot
    """

    def __init__(self, 
                 X=None, 
                 y=None, 
                 class_names: list = None, 
                 mode: str = "classification", 
                 random_samples: dict = None,
                 outdir: str = "",
                 feature_type: str = None,
                 global_explanation_sample_num: int = 10,
                 feature_map_reverse:dict = None,
                 model_finetune:bool = False,
                 fine_tune_cv_nfolds:int = 5,
                 scoring:str = "f1",
                 top_features_to_plot:int = 20,
                 trained_models_info:dict = None,
                 preprocessor: object = None
                ):
        """
        Initialize the LIME_Analysis class.

        Parameters:
        -----------
        X : pd.DataFrame, optional
            The feature matrix to be analyzed.
        y : pd.Series, optional
            The target variable corresponding to the feature matrix.
        class_names : list, optional
            The names of the target classes (for classification tasks).
        mode : str, optional, default="classification"
            Specifies the type of task: either "classification" or "regression".
        random_samples : dict, optional
            Dictionary containing random samples to be used for each class.
        outdir : str, optional, default=""
            The directory where the output plots and explanations will be saved.
        feature_type : str, optional
            Specifies the type of features (e.g., continuous or categorical).
        global_explanation_sample_num : int, optional, default=10
            The number of samples to use when generating global explanations.
        feature_map_reverse : dict, optional
            Dictionary to reverse map features for interpretation.
        model_finetune : bool, optional, default=False
            If True, the model will be fine-tuned before LIME analysis.
        fine_tune_cv_nfolds : int, optional, default=5
            The number of cross-validation folds for model fine-tuning.
        scoring : str, optional, default="f1"
            The scoring metric to be used for model fine-tuning (e.g., "accuracy", "f1").
        top_features_to_plot : int, optional, default = 20
            The number of features to display per plot
        """
        self.X = X
        self.y = y
        self.class_names = class_names
        self.mode = mode
        self.random_samples = random_samples
        self.outdir = outdir
        self.feature_type = feature_type
        self.global_explanation_sample_num = global_explanation_sample_num
        self.feature_map_reverse = feature_map_reverse
        self.scoring = scoring
        self.model_finetune = model_finetune
        self.fine_tune_cv_nfolds = fine_tune_cv_nfolds
        self.top_features_to_plot = top_features_to_plot
        self.trained_models_info = trained_models_info
        self.preprocessor = preprocessor
        


    def fit(self):
        """
        Fit the model and initialize the LIME explainer. (Model-Agnostic Path)
        """
        if self.trained_models_info:
            model_key = list(self.trained_models_info.keys())[0]
            logging.info(f"Using pre-trained model for LIME Analysis: {model_key}")
            self.fitted_model = self.trained_models_info[model_key]['model']
        else:
            raise ValueError("LIME analysis requires a pre-trained classification model, but none was provided.")
        
        if self.preprocessor is None:
            raise ValueError("LIME analysis in V2 pipeline requires a 'preprocessor' object, but none was provided.")

        # Transform X using preprocessor for LIME explainer
        X_processed = self.preprocessor.transform(self.X)
        # Ensure numpy array for LIME (it indexes with [:, i])
        if hasattr(X_processed, "to_numpy"):
            X_processed_np = X_processed.to_numpy()
        else:
            X_processed_np = np.asarray(X_processed)
        # Keep processed feature names to wrap inputs during predict to avoid sklearn warnings
        try:
            if hasattr(X_processed, "columns"):
                self._processed_feature_names = list(X_processed.columns)
            else:
                try:
                    self._processed_feature_names = list(self.preprocessor.get_feature_names_out())
                except Exception:
                    self._processed_feature_names = [f"feature_{i}" for i in range(X_processed_np.shape[1])]
        except Exception:
            self._processed_feature_names = [f"feature_{i}" for i in range(X_processed_np.shape[1])]
        logging.info(f"Initializing LIME Explainer for {model_key} using processed data")

        # initialize LIME explainer with processed data
        # Build display names for processed features that map back to original column names
        internal_cols = list(self.X.columns.values)
        proc_cols = list(getattr(self, "_processed_feature_names", []))
        if not proc_cols or len(proc_cols) != X_processed_np.shape[1]:
            try:
                proc_cols = list(self.preprocessor.get_feature_names_out())
            except Exception:
                proc_cols = [f"feature_{i}" for i in range(X_processed_np.shape[1])]

        def map_internal_to_original(tail: str) -> str:
            # Handles cases like 'Feature_12' or 'Feature_12_CategoryA'
            m = re.match(r"^(Feature_\d+)(.*)$", tail)
            if m:
                base_internal, suffix = m.group(1), m.group(2)
                try:
                    if self.feature_map_reverse and base_internal in self.feature_map_reverse:
                        return f"{self.feature_map_reverse[base_internal]}{suffix}"
                except Exception:
                    pass
            # Exact match mapping
            try:
                if self.feature_map_reverse and tail in self.feature_map_reverse:
                    return self.feature_map_reverse[tail]
            except Exception:
                pass
            return tail

        def to_display_name(proc_name: str) -> str:
            s = str(proc_name)
            tail = s.split("__")[-1] if "__" in s else s
            return map_internal_to_original(tail)

        mapped_feature_names = [to_display_name(p) for p in proc_cols]

        self.explainer = lime.lime_tabular.LimeTabularExplainer(
            training_data=X_processed_np,
            feature_names=mapped_feature_names,
            discretize_continuous=True,
            class_names=self.class_names[::-1],
            mode=self.mode,
            verbose=True,
            random_state=42
        )
         
    def _check_fit(self):
        """
        Checks if the model is fitted and the LIME explainer is initialized.
        If not, it calls the fit method to train the model.
        """
        if not hasattr(self, 'explainer') or self.explainer is None: # Ensure LIME values are computed before plotting
            logging.info("Training RandomForestClassifier for LIME Analysis")
            self.fit()
            
    def _predict_proba_with_feature_names(self, X):
        """
        Wrap incoming numpy arrays from LIME into a DataFrame with the
        processed feature names so that sklearn models fitted with feature
        names do not warn during predict/predict_proba.
        """
        try:
            if isinstance(X, np.ndarray):
                if X.ndim == 1:
                    X = X.reshape(1, -1)
                X = pd.DataFrame(X, columns=getattr(self, "_processed_feature_names", None))
            return self.fitted_model.predict_proba(X)
        except Exception:
            # Fallback to direct call if wrapping fails
            return self.fitted_model.predict_proba(X)

    def explain_samples(self):
        """
        Explain samples using LIME and plot the local explanation for the top n (top_features_to_plot) features.
        """
        self._check_fit()

        logging.info("Computing LIME Per Sample Explanations and Plotting") 
        #Explaining a random class 0 sample using top n(top_features_to_plot) features

        # Set font sizes for plots
        plt.rcParams.update({'font.size': 25})  # General font size
        plt.rcParams.update({'axes.titlesize': 25})  # Title font size
        plt.rcParams.update({'axes.labelsize': 25})  # Axis label font size

        # Get processed data for explanation as numpy
        X_processed = self.preprocessor.transform(self.X)
        X_processed = X_processed.to_numpy() if hasattr(X_processed, "to_numpy") else np.asarray(X_processed)

        exp0 = self.explainer.explain_instance(X_processed[self.random_samples[self.class_names[0]], :],
                                               self._predict_proba_with_feature_names, num_features=self.top_features_to_plot)
        #Plot local explanation
        plt2 = exp0.as_pyplot_figure()
        plt.title(f"Local explanation for class {self.class_names[0]} on an {self.class_names[0]} Sample", x=0.3)
        plt2.tight_layout()
        
        # Save the plot as a PNG file
        logging.info("Saving Plot 1")
        plt2.savefig(f'{self.outdir}/png/lime_local_explanation_plot_{self.class_names[0]}.png', bbox_inches='tight')
        plt2.savefig(f'{self.outdir}/pdf/lime_local_explanation_plot_{self.class_names[0]}.pdf', bbox_inches='tight')
        print(f'{self.outdir}/png/lime_local_explanation_plot_{self.class_names[0]}.png')

        #Explaining a random class 1 sample using top n (top_features_to_plot) features
        exp1 = self.explainer.explain_instance(X_processed[self.random_samples[self.class_names[1]], :],
                                               self._predict_proba_with_feature_names, num_features=self.top_features_to_plot)
        #Plot local explanation
        plt2 = exp1.as_pyplot_figure()
        plt.title(f"Local explanation for class {self.class_names[0]} on an {self.class_names[1]} Sample", x=0.3, fontsize=25)
        plt2.tight_layout()
        
        # Save the plot as a PNG file
        logging.info("Saving Plot 2")
        plt2.savefig(f'{self.outdir}/png/lime_local_explanation_plot_{self.class_names[1]}.png', bbox_inches='tight')
        plt2.savefig(f'{self.outdir}/pdf/lime_local_explanation_plot_{self.class_names[1]}.pdf', bbox_inches='tight')
        print(f'{self.outdir}/png/lime_local_explanation_plot_{self.class_names[1]}.png')

    def get_lime_explanations(self):
        """
        Generate LIME explanations for all samples in the dataset.

        Returns:
        - explanations (list): A list of feature importance pairs for each sample.
        """
        self._check_fit()
        logging.info(f"Computing LIME Explanations from {self.global_explanation_sample_num} samples") 
        # Define the number of samples you want from each class
        n0 = min(self.global_explanation_sample_num, sum(self.y==0))
        n1 = min(self.global_explanation_sample_num, sum(self.y==1))
        
        # Separate the data into two classes
        class_0_indices = np.where(self.y == 0)[0]
        class_1_indices = np.where(self.y == 1)[0]
        
        # Randomly sample n indices from each class
        class_0_sample = np.random.choice(class_0_indices, n0, replace=False)
        class_1_sample = np.random.choice(class_1_indices, n1, replace=False)
        
        # Combine the sampled indices
        sample_indices = np.concatenate([class_0_sample, class_1_sample])
        
        # Get processed data for explanation
        X_processed = self.preprocessor.transform(self.X)
        X_processed = X_processed.to_numpy() if hasattr(X_processed, "to_numpy") else np.asarray(X_processed)
        X_new = X_processed[sample_indices]
        
        # Optionally, shuffle the new data
        shuffled_indices = np.random.permutation(X_new.shape[0])
        X_new = X_new[shuffled_indices]
        print("X_new.shape[0]: ",X_new.shape[0])
        explanations = []
        for i in range(X_new.shape[0]):
            exp = self.explainer.explain_instance(X_new[i], self._predict_proba_with_feature_names,
                                                  num_features=X_new.shape[1])
            explanations.append(exp.as_list())
        return explanations   


    def aggregate_explanations(self):
        """
        Aggregate the LIME explanations to calculate mean and standard deviation of feature importance.

        Returns:
        - feature_means (dict): Mean importance of each feature.
        - feature_stds (dict): Standard deviation of importance for each feature.
        """
        self._check_fit()
        logging.info(f"Aggregating LIME explanations from {self.global_explanation_sample_num} samples")
        # Suppress print statements
        with open(os.devnull, 'w') as fnull:
            with contextlib.redirect_stdout(fnull):
                # Code block to suppress output
                explanations = self.get_lime_explanations()
        
        feature_importances = {}
        for explanation in explanations:
            for feature, importance in explanation:
                # clean features
                if feature in feature_importances:
                    feature_importances[feature.split(">")[0].split("<=")[0].split("<")[-1].strip()].append(importance)
                else:
                    feature_importances[feature.split(">")[0].split("<=")[0].split("<")[-1].strip()] = [importance]
    
        feature_means = {k: np.mean(v) for k, v in feature_importances.items()}
        feature_stds = {k: np.std(v) for k, v in feature_importances.items()}
    
        return feature_means, feature_stds


    def limeFeatureImportance(self):
        """
        Plot and return the feature importance from LIME explanations.

        Returns:
        - top_features (dict): Dictionary of top features with their importance.
        """
        self._check_fit()
        logging.info(f"Computing LIME Feature Importances from {self.global_explanation_sample_num} samples")
        feature_means, feature_stds = self.aggregate_explanations()

        # Convert feature means and stds to a DataFrame
        feature_df = pd.DataFrame(list(feature_means.items()), columns=['Feature', 'Mean Importance'])
        feature_df['Std Importance'] = feature_stds.values()
        
        # Sort by absolute mean importance and select top 30 features
        feature_df['Abs Mean Importance'] = feature_df['Mean Importance'].abs()
        top_n_features = feature_df.sort_values(by='Abs Mean Importance', ascending=False).head(self.top_features_to_plot)
        
        # Set colors for positive and negative mean importance
        colors = top_n_features['Mean Importance'].apply(lambda x: 'green' if x > 0 else 'red')
        
        # Plot the original mean importance values with error bars
        plt.figure(figsize=(4, 8))
        bars = plt.barh(top_n_features['Feature'], top_n_features['Mean Importance'], 
                        xerr=top_n_features['Std Importance'], color=colors)
        plt.title(f'LIME Feature Importance of Top Differentiating {self.feature_type}s',fontsize=20, loc='center', pad=15)
        plt.gca().invert_yaxis()
        plt.xlabel('Mean Importance', fontsize=20)
        plt.xticks(fontsize=18)
        plt.yticks(fontsize=18)


        # save
        logging.info("Saving LIME Feature Importance Plots")
        plt.savefig(f'{self.outdir}/png/lime_summary_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/pdf/lime_summary_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/png/lime_summary_plot.png')

        #plt.show()
        feature_df = feature_df.sort_values(by = "Abs Mean Importance", ascending = False)

        # Save LIME feature importance CSV for download
        try:
            os.makedirs(self.outdir, exist_ok=True)
            feature_df.to_csv(
                f"{self.outdir}/lime_feature_importance.csv",
                index=False,
                sep=';',
                encoding='utf-8-sig'
            )
        except Exception:
            pass

        top_features = {feature_df.Feature[i] : feature_df["Abs Mean Importance"][i] for i in range(len(feature_df))}
        return top_features



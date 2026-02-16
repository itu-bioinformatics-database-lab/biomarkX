import os, json
import sys
import numpy as np 
import pandas as pd
from sklearn import set_config
set_config(transform_output = "pandas")

from catboost import CatBoostClassifier
from sklearn.ensemble import (
    AdaBoostClassifier, GradientBoostingClassifier, RandomForestClassifier
)
from sklearn.tree import DecisionTreeClassifier
from xgboost import XGBClassifier 
from sklearn.svm import SVC
from sklearn.neural_network import MLPClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder,StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score


from modules.exception import CustomException
from modules.logger import logging
from modules.utils import save_object, evaluate_models, load_json, save_json, getparams
from modules.modelExplanation.feature_importance_analysis import plot_feature_importance
import re

class Classification:
    """
    A class for performing machine learning classification tasks, including data preprocessing,
    model training, and model evaluation with cross-validation.

    Parameters
    ----------
    data : pd.DataFrame, optional
        The input dataset. Default is None.
    labels_column : str, optional
        The column name of the target variable (labels). Default is "Diagnosis".
    n_folds : int, optional
        Number of cross-validation folds. Default is 10.
    test_size : float, optional
        Proportion of the data to use for the test set. Default is 0.2.
    outdir : str, optional
        Directory to save outputs such as models, transformers, and reports. Default is "outputs".
    param_finetune : bool, optional
        Whether to perform hyperparameter tuning. Default is False.
    finetune_fraction : float, optional
        Fraction of the dataset to use for hyperparameter tuning. Default is 1.0.
    save_best_model : bool, optional
        Whether to save the best performing model. Default is False.
    standard_scaling : bool, optional
        Whether to apply standard scaling to numerical features. Default is False.
    save_data_transformer : bool, optional
        Whether to save the data preprocessing transformer object. Default is False.
    save_label_encoder : bool, optional
        Whether to save the label encoder object. Default is False.
    model_list : list, optional
        List of models to use for classification. Default includes "Logistic Regression" and "Decision Tree".
    verbose : bool, optional
        Whether to print detailed logs during execution. Default is True.
    num_top_features : int, optional
        Number of top features to display in feature importance plots. Default is 20.

    Attributes
    ----------
    data : pd.DataFrame
        The input dataset with modified column names.
    labels_column : str
        The column name of the target variable (labels).
    n_folds : int
        Number of cross-validation folds.
    test_size : float
        Proportion of the data used for testing.
    param_finetune : bool
        Whether to perform hyperparameter tuning.
    finetune_fraction : float
        Fraction of data used for hyperparameter tuning.
    model_list : list
        List of models to use for classification.
    verbose : bool
        Whether to print detailed logs.
    """
    
    def __init__(self,
                 data = None,
                 labels_column:str = "Diagnosis",
                 n_folds:int = 10,
                 test_size:float = 0.2,
                 outdir:str="outputs",
                 param_finetune:bool = False,
                 finetune_fraction:float = 1.0,
                 save_best_model:bool = False,
                 standard_scaling:bool = False,
                 save_data_transformer:bool = False,
                 save_label_encoder:bool = False,
                 model_list:list = ["Logistic Regression", "Decision Tree"],
                 verbose:bool = True,
                 scoring:str = "f1",
                 num_top_features:int = 20,
                 use_preprocessing: bool = False
                 ):
        """
        Initialize the Classification class with dataset and configuration options.
        """

        # Preserve original->internal feature mapping so we can reverse map
        self.original_columns = list(data.columns)
        self.labels_column = labels_column
        self.feature_map = {feature: (labels_column if feature == labels_column else f"Feature_{i}") for i, feature in enumerate(self.original_columns)}
        self.feature_map_reverse = {v: k for k, v in self.feature_map.items()}

        self.data = data.copy()
        self.data.columns = [self.feature_map[col] for col in self.original_columns]
        self.outdir = outdir
        self.labels_column = labels_column
        self.n_folds = n_folds
        self.test_size = test_size
        self.param_finetune = param_finetune
        self.finetune_fraction = finetune_fraction
        self.save_best_model = save_best_model
        self.standard_scaling = standard_scaling
        self.save_data_transformer = save_data_transformer
        self.save_label_encoder = save_label_encoder
        self.model_list = model_list
        self.verbose = verbose
        self.num_top_features = num_top_features
        self.scoring = scoring
        self.use_preprocessing = use_preprocessing
        # Will be populated after fitting the transformer when categorical encoding is applied
        self.categorical_encoding_info = {}
        

    def build_transformer(self):
        
        """
        Create a data preprocessing pipeline for numerical and categorical features.

        Returns
        -------
        ColumnTransformer
            A transformer object for numerical and categorical feature processing.
        
        Raises
        ------
        CustomException
            If an error occurs during transformer construction.
        """
        try:
            # Allow disabling preprocessing and passing features through unchanged
            if not self.use_preprocessing:
                logging.info("Preprocessing is DISABLED. Applying minimum preprocessing: numeric imputation + categorical one-hot.")
                # Minimum preprocessing: impute numerics, impute+OHE categoricals, no scaling
                min_num_pipeline = Pipeline(
                    steps=[
                    ("imputer", SimpleImputer(strategy="median")),
                    ]
                )
                min_cat_pipeline = Pipeline(
                    steps=[
                    ("imputer", SimpleImputer(strategy="most_frequent")),
                    ("categorical_encoder", OneHotEncoder(handle_unknown='ignore', sparse_output=False)),
                    ]
                )
                preprocessor = ColumnTransformer(
                    [
                    ("num_pipeline", min_num_pipeline, self.numerical_columns),
                    ("cat_pipeline", min_cat_pipeline, self.categorical_columns),
                    ],
                    remainder="drop"
                )
                return preprocessor

            # set standard scaling configs
            if self.standard_scaling:
                num_standard_scaler = StandardScaler()
                cat_standard_scaler = StandardScaler(with_mean=False)
            else:
                num_standard_scaler = None
                cat_standard_scaler = None
            
            num_pipeline= Pipeline(
                steps=[
                ("imputer",SimpleImputer(strategy="median")),
                ("scaler",num_standard_scaler),
                ]
            )
            cat_pipeline=Pipeline(
                steps=[
                ("imputer",SimpleImputer(strategy="most_frequent")),
                ("categorical_encoder",OneHotEncoder(handle_unknown='ignore', sparse_output=False)),
                ("scaler",cat_standard_scaler)
                ]
            )
            preprocessor=ColumnTransformer(
                [
                ("num_pipeline",num_pipeline,self.numerical_columns),
                ("cat_pipelines",cat_pipeline,self.categorical_columns)
                ]
            )

            return preprocessor
        
        except Exception as e:
            raise CustomException(e,sys)

    
    def _strip_transformer_prefix(self, column_name):
        """
        Normalize transformed feature names coming from ColumnTransformer with
        pandas output. It strips any pipeline/step prefixes like
        "num_pipeline__Feature_12" -> "Feature_12" so that reverse mapping to
        original column names works correctly.
        """
        if isinstance(column_name, str) and "__" in column_name:
            return column_name.split("__")[-1]
        return column_name

    def data_transfrom(self):
        """
        Split the data into training and test sets, encode labels, and apply preprocessing.

        Returns
        -------
        None

        Raises
        ------
        CustomException
            If an error occurs during data transformation.
        """

        logging.info("Transforming Data: Encoding Labels, Creating a Train/Test Split, Transforming Features")
        try:
            # create train test split
            self.X = self.data.drop(self.labels_column, axis = 1)
            self.labels = self.data[self.labels_column]
            # Keep class names for JSON grouping
            self.class_names = list(pd.Series(self.labels).unique())
    
            # encode labels
            label_encoder = LabelEncoder()
            self.y = label_encoder.fit_transform(self.labels)

            # Auto-switch scoring for multi-class (3+ classes)
            n_classes = len(self.class_names)
            if n_classes > 2 and self.scoring == "f1":
                self.scoring = "f1_weighted"
                logging.info(f"Multi-class detected ({n_classes} classes): switching scoring to f1_weighted")
    
            # save encoder
            if self.save_label_encoder:
                save_object(f"{self.outdir}/artifacts/label_encoder.pkl", label_encoder)
            
            X_train, X_test, self.y_train, self.y_test = train_test_split(
                self.X,
                self.y,
                test_size=self.test_size,
                random_state=42,
                stratify=self.y
            )
            # keep raw splits for CV inside Pipeline (to avoid leakage)
            self.X_train_raw = X_train.copy()
            self.X_test_raw = X_test.copy()
    
            # initialize transformer
            self.numerical_columns = [feature for feature in self.X.columns if self.X[feature].dtype != 'O']
            self.categorical_columns = [feature for feature in self.X.columns if self.X[feature].dtype == 'O']
            
            # Log column identification
            logging.info(f"Identified {len(self.numerical_columns)} numerical columns and {len(self.categorical_columns)} categorical columns")
            if self.categorical_columns:
                logging.info(f"Categorical columns: {self.categorical_columns}")
            
            self.preprocessor = self.build_transformer()
            
            # fit transformer and transform training data
            self.X_train = self.preprocessor.fit_transform(X_train)
            # transform test data
            self.X_test = self.preprocessor.transform(X_test)

            # Populate categorical encoding info for frontend (if One-Hot was used)
            try:
                cat_transformer = None
                if hasattr(self.preprocessor, 'named_transformers_'):
                    if 'cat_pipelines' in self.preprocessor.named_transformers_:
                        cat_transformer = self.preprocessor.named_transformers_['cat_pipelines']
                    elif 'cat_pipeline' in self.preprocessor.named_transformers_:
                        cat_transformer = self.preprocessor.named_transformers_['cat_pipeline']

                if cat_transformer and hasattr(cat_transformer, 'named_steps') and 'categorical_encoder' in cat_transformer.named_steps:
                    ohe = cat_transformer.named_steps['categorical_encoder']
                    if hasattr(ohe, 'categories_') and self.categorical_columns:
                        info = {}
                        for col, cats in zip(self.categorical_columns, ohe.categories_):
                            # Map internal Feature_i back to original column name for UI
                            original_col = self.feature_map_reverse.get(col, col)
                            # For display, generate human-readable OHE columns using original name
                            generated = [f"{original_col}_{str(cat)}" for cat in cats]
                            info[original_col] = {
                                'generated_columns': generated,
                                'encoding_type': 'OneHot'
                            }
                        self.categorical_encoding_info = info
            except Exception:
                # Do not fail the pipeline if metadata extraction fails
                pass
    
            # save transformer
            if self.save_data_transformer:
                save_object(f"{self.outdir}/artifacts/preprocessor.pkl", self.preprocessor)

        except Exception as e:
            raise CustomException(e,sys)

    
    def initiate_model_trainer(self, return_models=False):
        """
        Train models and evaluate their performance using cross-validation.
        Also handles feature importance plotting for specific models.

        Parameters
        ----------
        return_models : bool, optional
            If True, returns the trained model objects and their paths. 
            Default is False.

        Returns
        -------
        tuple or dict
            If return_models is False, returns a tuple of (best_model_name, best_model_score).
            If return_models is True, returns a dictionary containing trained model info.

        Raises
        ------
        CustomException
            If an error occurs during model training or evaluation.
        """
        try:

            models_base = {
                "logistic regression": LogisticRegression(random_state = 42, solver = "lbfgs", penalty = "l2", max_iter = 2000),
                "random forest": RandomForestClassifier(random_state = 42, n_jobs=-1),
                "xgbclassifier": XGBClassifier(random_state = 42, n_jobs=-1),
                "decision tree": DecisionTreeClassifier(random_state = 42), 
                "gradient boosting": GradientBoostingClassifier(random_state = 42),
                "catboosting classifier": CatBoostClassifier(random_state = 42,verbose=False),
                "adaboost classifier": AdaBoostClassifier(random_state = 42),
                "mlpclassifier": MLPClassifier(random_state = 42, verbose=False),
                "svc": SVC(kernel="rbf",random_state = 42, probability=True)
                }
            models = {model_name:models_base[model_name] for model_name in self.model_list}
            
            params = getparams()

            logging.info("TRAINING AND EVALUATING MODELS")
            model_report:dict=evaluate_models(X_train=self.X_train,
                                              y_train=self.y_train,
                                              X_test=self.X_test,
                                              y_test=self.y_test,
                                              models=models,
                                              param=params,
                                              n_folds = self.n_folds,
                                              param_finetune = self.param_finetune,
                                              finetune_fraction = self.finetune_fraction,
                                              verbose = self.verbose,
                                              outdir = self.outdir,
                                              scoring = self.scoring,
                                              X_train_raw = getattr(self, 'X_train_raw', None),
                                              preprocessor = getattr(self, 'preprocessor', None)
                                              )
            
            # --- Built-in Feature Importance for XGBoost and RandomForest ---
            # Standardize model names for feature importance check
            xgb_key = "xgbclassifier"
            rf_key = "random forest"
            for model_name, model_instance in models.items():

                # Compare in a case-insensitive way or with the standardized keys
                if hasattr(model_instance, 'feature_importances_'):
                    if self.verbose:
                        print(f"Generating feature importance plot for {model_name}...")
                    
                    # Create a temporary dictionary for this model's importance
                    # Reverse map internal names (Feature_i) to original names for display
                    internal_feature_names = [self._strip_transformer_prefix(col) for col in self.X_train.columns.tolist()]
                    readable_feature_names = [self.feature_map_reverse.get(col, col) for col in internal_feature_names]
                    feature_importance_dict = {
                        model_name: {
                            "feature_names": readable_feature_names,
                            "feature_importances": model_instance.feature_importances_.tolist()
                        }
                    }                    
                    # Generate and save the plot
                    plot_feature_importance(
                        feature_importance_dict,
                        outdir=self.outdir,
                        num_top_features=self.num_top_features
                    )

                    # Also update feature_importances.json grouped by class pairs
                    try:
                        # Save at base results/<file>/feature_importances.json
                        # self.outdir is results/<file>/<class_pair>/... -> go two levels up
                        base_outdir = os.path.dirname(os.path.dirname(self.outdir))
                        json_path = os.path.join(base_outdir, "feature_importances.json")

                        if os.path.exists(json_path):
                            with open(json_path, "r") as f:
                                try:
                                    existing_data = json.load(f)
                                except json.JSONDecodeError:
                                    existing_data = {}
                        else:
                            existing_data = {}

                        # Class pair key
                        if hasattr(self, 'class_names') and len(self.class_names) >= 2:
                            class_pair = "_vs_".join(sorted(str(c) for c in self.class_names))
                        else:
                            # Fallback if class names missing
                            class_pair = "all_classes"

                        if class_pair not in existing_data:
                            existing_data[class_pair] = {}

                        # Save importances under model-specific keys
                        # Preserve legacy keys for XGB/RF, generalize others
                        if model_name.lower() == xgb_key:
                            model_key = "xgb_feature_importance"
                        elif model_name.lower() == rf_key:
                            model_key = "randomforest_feature_importance"
                        else:
                            slug = re.sub(r'[^a-z0-9]+', '', model_name.lower())
                            model_key = f"{slug}_feature_importance" if slug else "model_feature_importance"
                        if model_key not in existing_data[class_pair]:
                            existing_data[class_pair][model_key] = {}

                        for feat_name, importance in zip(readable_feature_names, model_instance.feature_importances_.tolist()):
                            existing_data[class_pair][model_key][feat_name] = float(importance)

                        with open(json_path, "w") as f:
                            json.dump(existing_data, f, indent=4)
                    except Exception:
                        # Do not fail training due to JSON write
                        pass

            # Update the JSON file with new model results without resetting existing content
            json_path = f"{self.outdir}/model_reports.json"            
            
            # Read existing data if available
            if os.path.exists(json_path):
                with open(json_path, "r") as f:
                    try:
                        existing_data = json.load(f)  # Read JSON file
                    except json.JSONDecodeError:
                        existing_data = {}  # If JSON is corrupted, start with empty dict
            else:
                existing_data = {}  # If file does not exist, start empty

            # Update existing data with new model results
            existing_data.update(model_report)  # Add new results to existing data

            # Save updated JSON
            with open(json_path, "w") as f:
                json.dump(existing_data, f, indent=4)

            # --- Combined summary across models (CSV) ---
            try:
                combined_dir = os.path.join(self.outdir, 'models')
                os.makedirs(combined_dir, exist_ok=True)

                combined_rows = []
                for m, rep in model_report.items():
                    combined_rows.append({
                        'Model': m,
                        'CV_Accuracy_Mean': rep['cross_val_report']['accuracy']['mean'],
                        'CV_Precision_Mean': rep['cross_val_report']['precision']['mean'],
                        'CV_Recall_Mean': rep['cross_val_report']['recall']['mean'],
                        'CV_F1_Mean': rep['cross_val_report']['f1']['mean'],
                        'CV_ROC_AUC_Mean': rep['cross_val_report']['roc_auc']['mean'],
                        'Train_Accuracy': rep['train_report']['accuracy'],
                        'Train_Precision': rep['train_report']['precision'],
                        'Train_Recall': rep['train_report']['recall'],
                        'Train_F1': rep['train_report']['f1'],
                        'Train_ROC_AUC': rep['train_report']['roc_auc'],
                        'Test_Accuracy': rep['test_report']['accuracy'],
                        'Test_Precision': rep['test_report']['precision'],
                        'Test_Recall': rep['test_report']['recall'],
                        'Test_F1': rep['test_report']['f1'],
                        'Test_ROC_AUC': rep['test_report']['roc_auc'],
                    })

                pd.DataFrame(combined_rows).to_csv(
                    os.path.join(combined_dir, 'classification_summary.csv'),
                    index=False,
                    sep=';',
                    encoding='utf-8-sig'
                )
            except Exception:
                # Do not fail due to CSV write
                pass
                
            ## To get best model score from dict
            best_model_score = 0
            best_model_name = ""

            for model_name in model_report:
                score = model_report[model_name]["cross_val_report"]["f1"]["mean"]

                if score >= best_model_score:
                    best_model_score = score
                    best_model_name = model_name
            
            # Ensure the best_model_name key exists in the standardized 'models' dict
            if best_model_name in models:
                best_model = models[best_model_name]
            else:
                # Handle cases where model_report might have differently cased keys
                # (though evaluate_models should be consistent)
                standardized_best_name = next((k for k in models.keys() if k.lower() == best_model_name.lower()), None)
                if standardized_best_name:
                    best_model = models[standardized_best_name]
                else:
                    # Fallback or error
                    raise CustomException(f"Best model '{best_model_name}' not found in trained models after standardization.", sys)


            if best_model_score < 0.1:
                raise CustomException("No best model found", sys)

            # save best model
            if self.save_best_model:
                save_object(f"{self.outdir}/artifacts/best_model_{best_model_name}.pkl",best_model)
            
            # --- Return trained models if requested ---
            if return_models:
                trained_models_info = {}
                for model_name, model_instance in models.items():
                    model_path = f"{self.outdir}/artifacts/explanation_model_{model_name}.pkl"
                    save_object(model_path, model_instance)
                    trained_models_info[model_name] = {
                        "model": model_instance,
                        "model_path": model_path
                    }
                return trained_models_info, self.preprocessor

            # Update the JSON file with new model results without resetting existing content
            json_path = f"{self.outdir}/model_reports.json"            
            
            # Read existing data if available
            if os.path.exists(json_path):
                with open(json_path, "r") as f:
                    try:
                        existing_data = json.load(f)  # Read JSON file
                    except json.JSONDecodeError:
                        existing_data = {}  # If JSON is corrupted, start with empty dict
            else:
                existing_data = {}  # If file does not exist, start empty

            # Update existing data with new model results
            existing_data.update(model_report)  # Add new results to existing data

            # Save updated JSON
            with open(json_path, "w") as f:
                json.dump(existing_data, f, indent=4)
                        
            logging.info("MODEL TRAINING AND EVALUATION COMPLETE")
            print(best_model_name)
            print(f"Best model: {best_model_name}\nBest model cross validation score: {best_model_score}")
            
            
        except Exception as e:
            raise CustomException(e,sys)
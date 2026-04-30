import os
import sys

import numpy as np 
import pandas as pd
import seaborn as sns 
import matplotlib.pyplot as plt
from tqdm import tqdm
import json
import dill
import pickle

from sklearn.metrics import f1_score, accuracy_score, roc_auc_score, precision_score, recall_score
from sklearn.metrics import make_scorer
from sklearn.model_selection import cross_validate
from sklearn.model_selection import GridSearchCV, KFold, StratifiedKFold
from sklearn.metrics import classification_report


from modules.exception import CustomException
from modules.logger import logging

# Save a Python object to a file using pickle

def save_object(file_path, obj):
    try:
        dir_path = os.path.dirname(file_path)

        os.makedirs(dir_path, exist_ok=True)

        with open(file_path, "wb") as file_obj:
            pickle.dump(obj, file_obj)

        logging.info(f"Saved Model object at '{file_path}'")
    except Exception as e:
        raise CustomException(e, sys)

    
# Load a Python object from a file using pickle

def load_object(file_path):
    try:
        with open(file_path, "rb") as file_obj:
            return pickle.load(file_obj)

        logging.info(f"Loaded object from '{file_path}'")

    except Exception as e:
        raise CustomException(e, sys)
    

# Load JSON data as a dictionary

def load_json(json_path):
    """
    Load json data as a dictionary
    """

    try:
        with open(json_path) as f:
            file = f.read()
        json_data = json.loads(file)
        logging.info(f"Loaded JSON data from '{json_path}'")
    except Exception as e:
        raise CustomException(e, sys)

    return json_data

# Save a dictionary or object as a JSON file

def save_json(file_path, obj):
    try:
        dir_path = os.path.dirname(file_path)

        os.makedirs(dir_path, exist_ok=True)

        json_object = json.dumps(obj, indent=2)

        with open(file_path, "w") as file_obj:
            file_obj.write(json_object)
        logging.info(f"Saved JSON data at '{file_path}'")

    except Exception as e:
        raise CustomException(e, sys)

# Train and evaluate multiple models using cross-validation and test sets

def evaluate_models(X_train, 
                    y_train,
                    X_test,
                    y_test,
                    models,
                    param, 
                    param_finetune = True, 
                    n_folds = 10, 
                    finetune_fraction = 1.0, 
                    verbose:bool = True,
                    outdir = None,
                    scoring: str = "f1",
                    X_train_raw = None,
                    y_train_raw = None,
                    preprocessor = None,
                    resampler = None
                   ):
    """
    Train and evaluate multiple models using cross-validation and test sets.

    Args:
    X_train, y_train: Training features and labels.
    X_test, y_test: Test features and labels.
    models (dict): Dictionary of model names and model objects.
    param (dict): Dictionary of hyperparameters for models.
    param_finetune (bool): If True, perform hyperparameter tuning using GridSearchCV.
    n_folds (int): Number of folds for cross-validation.
    finetune_fraction (float): Fraction of training data used for hyperparameter tuning.
    verbose (bool): If True, print training and evaluation details.
    outdir (str): Output directory to save model evaluation results as tables.

    Returns:
    dict: Report containing cross-validation, training, and test performance for each model.

    Raises:
    CustomException: If any error occurs during model training or evaluation.
    """
    try:
        report = {}
        best_params_by_model = {}

        kfold = StratifiedKFold(n_splits=n_folds, random_state=42, shuffle = True)

        if verbose:
            length = 110
            print("=" * length)
            print(" Starting Model Training and Evaluation")
            print("=" * length)

        logging.info("Interating over Models")
        for i in range(len(list(models))):
            model = list(models.items())[i][1]
            model_name = list(models.items())[i][0]

            logging.info(f"Training {model_name} model")
            if verbose:
                print("=" * length)
                print(f" Starting {model_name} Model Training and Evaluation")
                print("=" * length)
            if param_finetune:
                logging.info(f"Fine tunning {model_name} model")
                # Prefer raw X and an unfitted preprocessor to avoid leakage
                use_pipeline_cv = (preprocessor is not None) and (X_train_raw is not None)

                # Build CV data (stratified subsample if requested)
                if use_pipeline_cv:
                    X_source = X_train_raw
                    # Use y_train_raw if available so array lengths match X_train_raw
                    y_source = pd.Series(y_train_raw if y_train_raw is not None else y_train).values
                    if finetune_fraction < 1.0:
                        from sklearn.model_selection import StratifiedShuffleSplit
                        splitter = StratifiedShuffleSplit(n_splits=1, train_size=finetune_fraction, random_state=42)
                        idx_train, _ = next(splitter.split(np.asarray(X_source), y_source))
                        # X_source is expected to be DataFrame; fall back to iloc if available, else array indexing
                        if hasattr(X_source, 'iloc'):
                            X_train_cv = X_source.iloc[idx_train]
                        else:
                            X_train_cv = X_source[idx_train]
                        y_train_cv = y_source[idx_train]
                    else:
                        X_train_cv = X_source
                        y_train_cv = y_source
                else:
                    # Fallback to already transformed features (may introduce mild leakage)
                    if finetune_fraction < 1.0:
                        from sklearn.model_selection import StratifiedShuffleSplit
                        splitter = StratifiedShuffleSplit(n_splits=1, train_size=finetune_fraction, random_state=42)
                        X_arr = np.asarray(X_train)
                        y_arr = pd.Series(y_train).values
                        idx_train, _ = next(splitter.split(X_arr, y_arr))
                        X_train_cv = X_arr[idx_train]
                        y_train_cv = y_arr[idx_train]
                    else:
                        X_train_cv = np.asarray(X_train)
                        y_train_cv = pd.Series(y_train).values

                # Match hyperparameter grid dict using case-insensitive key mapping
                model_key = list(models.keys())[i]
                param_key = next((k for k in param.keys() if k.lower() == model_key.lower()), None)
                if param_key is None:
                    raise CustomException(f"Hyperparameter grid not found for model '{model_key}'", sys)
                para = param[param_key]

                # If we can, run GridSearch over a Pipeline to refit preprocessing per fold
                if use_pipeline_cv:
                    try:
                        from sklearn.base import clone
                        if resampler is not None:
                            from imblearn.pipeline import Pipeline as ImbPipeline
                            pipe = ImbPipeline([
                                ('preprocess', clone(preprocessor)),
                                ('resample', clone(resampler)),
                                ('model', model)
                            ])
                        else:
                            from sklearn.pipeline import Pipeline
                            pipe = Pipeline([
                                ('preprocess', clone(preprocessor)),
                                ('model', model)
                            ])
                            
                        # Prefix grid keys with model__
                        if isinstance(para, list):
                            para_prefixed = [{f"model__{k}": v for k, v in d.items()} for d in para]
                        else:
                            para_prefixed = {f"model__{k}": v for k, v in para.items()}
                        gs = GridSearchCV(pipe,
                                          para_prefixed,
                                          cv=kfold,
                                          scoring=scoring,
                                          n_jobs=-1,
                                          error_score=np.nan)
                        gs.fit(X_train_cv, y_train_cv)
                        # Strip model__ prefix for setting on the bare estimator
                        raw_best = gs.best_params_
                        model_best_params = { (k.split('model__',1)[1] if k.startswith('model__') else k): v for k, v in raw_best.items() }
                    except Exception as e:
                        logging.error(f"Pipeline-based GS failed: {str(e)}. Falling back to legacy GS.")
                        # Fallback to legacy behavior if pipeline-based GS fails
                        gs = GridSearchCV(model,
                                          para,
                                          cv=kfold,
                                          scoring=scoring,
                                          n_jobs=-1,
                                          error_score=np.nan)
                        gs.fit(X_train_cv, y_train_cv)
                        model_best_params = gs.best_params_
                else:
                    gs = GridSearchCV(model,
                                      para,
                                      cv=kfold,
                                      scoring=scoring,
                                      n_jobs=-1,
                                      error_score=np.nan)
                    gs.fit(X_train_cv, y_train_cv)
                    model_best_params = gs.best_params_

                model.set_params(**model_best_params)
                # keep best params for later reporting
                best_params_by_model[model_name] = model_best_params
            model.fit(X_train,y_train)

            #get cross validation and test report
            logging.info(f"Cross Validating {model_name} model")
            cross_val_report = get_cross_validation_scores(model, X_train,y_train, cv= kfold)
            
            # make predictions
            
            y_train_pred = model.predict(X_train)  # prediction on train set (labels)
            y_test_pred = model.predict(X_test)   # prediction on test set (labels)

            # collect probability/score outputs for better ROC-AUC
            def _prediction_scores(m, X):
                try:
                    if hasattr(m, "predict_proba"):
                        proba = m.predict_proba(X)
                        # binary -> return positive class prob; multi-class -> return full matrix
                        if isinstance(proba, np.ndarray) and proba.ndim == 2 and proba.shape[1] == 2:
                            return proba[:, 1]
                        return proba
                    if hasattr(m, "decision_function"):
                        return m.decision_function(X)
                except Exception:
                    pass
                # fallback: use label predictions (poorer AUC)
                try:
                    return m.predict(X)
                except Exception:
                    return None

            y_train_scores = _prediction_scores(model, X_train)
            y_test_scores = _prediction_scores(model, X_test)

            logging.info(f"Testing {model_name} model")

            train_report = get_test_report(y_train, y_train_pred, scores=y_train_scores)
            test_report = get_test_report(y_test, y_test_pred, scores=y_test_scores)
            report[list(models.keys())[i]] = {"test_report":test_report, 
                                              "train_report":train_report, 
                                              "cross_val_report":cross_val_report}

            # 
            cv1 = cross_val_report["accuracy"]["mean"]
            cv2 = cross_val_report["precision"]["mean"]
            cv3 = cross_val_report["recall"]["mean"]
            cv4 = cross_val_report["f1"]["mean"]
            cv5 = cross_val_report["roc_auc"]["mean"]
            cv6 = int(len(y_train)/n_folds)
    
            # 
            tr1 = train_report["accuracy"]
            tr2 = train_report["precision"]
            tr3 = train_report["recall"]
            tr4 = train_report["f1"]
            tr5 = train_report["roc_auc"]
            tr6 = len(y_train)
    
            # 
            te1 = test_report["accuracy"]
            te2 = test_report["precision"]
            te3 = test_report["recall"]
            te4 = test_report["f1"]
            te5 = test_report["roc_auc"]
            te6 = len(y_test)
            
            {'f1': 1.0, 'accuracy': 1.0, 'roc_auc': 1.0, 'precision': 1.0, 'recall': 1.0}
            s = f"""              
                                    accuracy    precision    recall    f1-score    roc_auc    support\n   
                cross validation    {cv1:.2f}        {cv2:.2f}         {cv3:.2f}      {cv4:.2f}        {cv5:.2f}       {cv6}
                train set           {tr1:.2f}        {tr2:.2f}         {tr3:.2f}      {tr4:.2f}        {tr5:.2f}       {tr6}
                test set            {te1:.2f}        {te2:.2f}         {te3:.2f}      {te4:.2f}        {te5:.2f}       {te6}\n
                """
            print(s)
                
            # Save model results as a table (if outdir is specified)
            if outdir:
                import matplotlib.pyplot as plt
                import matplotlib
                from matplotlib.backends.backend_pdf import PdfPages
                
                # Create model output directory
                model_outdir = os.path.join(outdir, 'models', model_name)
                os.makedirs(os.path.join(model_outdir, 'png'), exist_ok=True)
                os.makedirs(os.path.join(model_outdir, 'pdf'), exist_ok=True)
                
                # Create table data
                data = [
                    ['Cross Val', f"{cv1:.2f}", f"{cv2:.2f}", f"{cv3:.2f}", f"{cv4:.2f}", f"{cv5:.2f}", f"{cv6}"],
                    ['Train Set', f"{tr1:.2f}", f"{tr2:.2f}", f"{tr3:.2f}", f"{tr4:.2f}", f"{tr5:.2f}", f"{tr6}"],
                    ['Test Set', f"{te1:.2f}", f"{te2:.2f}", f"{te3:.2f}", f"{te4:.2f}", f"{te5:.2f}", f"{te6}"]
                ]
                
                # Create table
                fig, ax = plt.figure(figsize=(12, 1)), plt.subplot(111)
                ax.axis('off')
                ax.axis('tight')
                table = ax.table(cellText=data,
                                colLabels=['', 'Accuracy', 'Precision', 'Recall', 'F1-Score', 'ROC-AUC', 'Support'],
                                loc='center',
                                cellLoc='center')
                table.auto_set_font_size(False)
                table.set_fontsize(16)
                table.scale(1, 2.2)

                # Add title
                feature_status = "After Feature Selection" if "AfterFeatureSelection" in outdir else "Without Feature Selection"
                fig.suptitle(f'Results for Model: {model_name} ({feature_status})', fontsize=18, y=2)
                
            # Save as PNG
                png_path = os.path.join(model_outdir, 'png', f'{model_name}_results.png')
                plt.savefig(png_path, bbox_inches='tight', dpi=300)
                
                # Save as PDF
                with PdfPages(os.path.join(model_outdir, 'pdf', f'{model_name}_results.pdf')) as pdf:
                    pdf.savefig(fig, bbox_inches='tight')
                
                plt.close()
                logging.info(f"Model results saved to {model_outdir} directory.")
                
                # Print file path to stdout (to be captured by Node.js)
                relative_path = png_path.split('server/')[-1] if 'server/' in png_path else png_path
                print(relative_path)

            # --- Also save CSV exports for this model ---
            try:
                # 1) Summary table CSV (Cross Val / Train / Test)
                summary_df = pd.DataFrame(
                    data,
                    columns=['Split', 'Accuracy', 'Precision', 'Recall', 'F1-Score', 'ROC-AUC', 'Support']
                )
                summary_df.to_csv(os.path.join(model_outdir, f'{model_name}_results.csv'), index=False, sep=';', encoding='utf-8-sig')

                # 2) Per-fold CV scores CSV
                cv_all = cross_val_report
                folds = len(cv_all['accuracy']['all']) if isinstance(cv_all.get('accuracy', {}).get('all', []), list) else 0
                if folds > 0:
                    cv_df = pd.DataFrame({
                        'Fold': list(range(1, folds + 1)),
                        'Accuracy': cv_all['accuracy']['all'],
                        'Precision': cv_all['precision']['all'],
                        'Recall': cv_all['recall']['all'],
                        'F1-Score': cv_all['f1']['all'],
                        'ROC-AUC': cv_all['roc_auc']['all'],
                    })
                    cv_df.to_csv(os.path.join(model_outdir, f'{model_name}_cv_folds.csv'), index=False, sep=';', encoding='utf-8-sig')
            except Exception:
                # Do not fail evaluation due to CSV write issues
                pass
                
        if verbose:
            print("=" * length)
            print(f" Model Training and Evaluation Completed")
            print("=" * length)
                
        # If we collected any best params, print a special line for the Node server to capture
        try:
            if best_params_by_model:
                print("BEST_PARAMS:", json.dumps(best_params_by_model))
        except Exception:
            pass
        return report

    except Exception as e:
        raise CustomException(e, sys)
    
# Get cross validation scores for classification

def get_cross_validation_scores(model, X, y, cv):
    """
    Get cross validation scores:
        ('f1', 'precision', 'recall', 'roc_auc', "accuracy") for classification.
    Automatically uses weighted averaging for multi-class (3+ classes).
    """
    try:
        n_classes = len(np.unique(y))
        if n_classes > 2:
            scoring = ('f1_weighted', 'precision_weighted', 'recall_weighted', 'roc_auc_ovr_weighted', 'accuracy')
            # Map sklearn cross_validate keys back to standard metric names
            key_map = {
                'test_f1_weighted': 'f1',
                'test_precision_weighted': 'precision',
                'test_recall_weighted': 'recall',
                'test_roc_auc_ovr_weighted': 'roc_auc',
                'test_accuracy': 'accuracy',
            }
        else:
            scoring = ('f1', 'precision', 'recall', 'roc_auc', "accuracy")
            key_map = {
                'test_f1': 'f1',
                'test_precision': 'precision',
                'test_recall': 'recall',
                'test_roc_auc': 'roc_auc',
                'test_accuracy': 'accuracy',
            }
        scores = cross_validate(model, X, y, cv=cv,scoring=scoring,return_train_score=False)
        score_report = {key_map[k]: {"mean": scores[k].mean(),
                                     "std": scores[k].std(),
                                     "all": list(scores[k])}
                        for k in key_map if k in scores}
    except Exception as e:
        raise CustomException(e, sys)
    
    return score_report

# Get test set evaluation metrics

def get_test_report(true, predicted, scores=None):

    """
    Run Various Evaluation Metrics on data.
    Automatically uses weighted averaging for multi-class (3+ classes).
    """
    try:
        n_classes = len(np.unique(true))
        avg = 'weighted' if n_classes > 2 else 'binary'

        # Compute ROC-AUC using scores/probabilities if available
        try:
            roc_auc = None
            if scores is not None:
                arr = np.asarray(scores)
                if arr.ndim == 1:
                    if n_classes > 2:
                        roc_auc = None  # Cannot compute ROC-AUC from 1D scores for multi-class
                    else:
                        roc_auc = roc_auc_score(true, arr)
                elif arr.ndim == 2:
                    # Multi-class probability/score matrix
                    roc_auc = roc_auc_score(true, arr, multi_class='ovr', average='weighted')
            else:
                if n_classes <= 2:
                    roc_auc = roc_auc_score(true, predicted)
                else:
                    roc_auc = None  # Cannot compute from labels alone for multi-class
        except Exception:
            try:
                if n_classes <= 2:
                    roc_auc = roc_auc_score(true, predicted)
                else:
                    roc_auc = None
            except Exception:
                roc_auc = None

        score_report = {"f1": f1_score(true, predicted, average=avg),
                        "accuracy": accuracy_score(true, predicted),
                        "roc_auc": roc_auc,
                        "precision": precision_score(true, predicted, average=avg),
                        "recall": recall_score(true, predicted, average=avg)
                        }
        return score_report

    except Exception as e:
        raise CustomException(e, sys)

# Get tunable hyperparameters for various machine learning models

def getparams():

    """
    Returns a dictionary of tunable hyperparameters for various machine learning models.
    
    The dictionary includes common models like Decision Tree, Random Forest, Gradient Boosting,
    Logistic Regression, XGBClassifier, CatBoosting Classifier, AdaBoost Classifier, MLPClassifier, and SVC.
    
    Returns:
        dict: A dictionary where each key is a model name and the value is a dictionary of hyperparameters.
    """
    
    params = {
        "Decision Tree": {
            "criterion": ["gini", "entropy"],
            "splitter": ["best", "random"],
            "max_depth": [None, 3, 5, 10],
            "min_samples_split": [2, 5, 10],
            "min_samples_leaf": [1, 2, 4],
            "max_features": [None, "sqrt", "log2"]
        },
        "Random Forest": {
            "n_estimators": [100, 200, 300],
            "criterion": ["gini", "entropy"],
            "max_depth": [None, 3, 5, 10],
            "min_samples_split": [2, 5, 10],
            "min_samples_leaf": [1, 2, 4]
        },
        "Gradient Boosting": {
            "learning_rate": [0.001, 0.01, 0.1, 0.2],
            "n_estimators": [100, 200, 300],
            "subsample": [0.5, 0.7, 1.0],
            "criterion": ["friedman_mse", "squared_error"],
            "max_depth": [3, 5, 10],
            "min_samples_split": [2, 5, 10],
            "min_samples_leaf": [1, 2, 4],
            "max_features": [None, "sqrt", "log2"]
        },
        "Logistic Regression": [
            {
                "penalty": ["l2"],
                "C": [0.01, 0.1, 1.0, 10.0, 100.0],
                "solver": ["lbfgs"],
                "tol": [1e-3, 1e-4],
                "max_iter": [1000, 3000, 5000]
            },
            {
                "penalty": ["l1", "l2"],
                "C": [0.01, 0.1, 1.0, 10.0, 100.0],
                "solver": ["liblinear"],
                "tol": [1e-3, 1e-4],
                "max_iter": [1000, 3000, 5000]
            },
            {
                "penalty": ["elasticnet"],
                "C": [0.01, 0.1, 1.0, 10.0],
                "solver": ["saga"],
                "l1_ratio": [0.1, 0.5, 0.9],
                "tol": [1e-3, 1e-4],
                "max_iter": [3000, 5000]
            }
        ],
        "XGBClassifier": {
            "n_estimators": [100, 200, 300],
            "learning_rate": [0.001, 0.01, 0.1, 0.2],
            "max_depth": [3, 5, 7, 10],
            "subsample": [0.5, 0.7, 1.0],
            "gamma": [0, 0.1, 0.2],
        },
        "CatBoosting Classifier": {
            "iterations": [100, 200, 500],
            "learning_rate": [0.01, 0.1, 0.2, 0.3],
            "depth": [3, 5, 7, 10],
            "l2_leaf_reg": [1, 3, 5, 7],
            "bootstrap_type": ["Bayesian", "Bernoulli", "MVS"]
        },
        "AdaBoost Classifier": {
            "n_estimators": [50, 100, 200],
            "learning_rate": [0.001, 0.01, 0.1, 1.0],
            "algorithm": ["SAMME", "SAMME.R"]
        },
        "MLPClassifier": [
            # adam with early stopping and higher max_iter
            {
                "solver": ["adam"],
                "activation": ["relu", "tanh"],
                "hidden_layer_sizes": [(50,), (100,), (100, 50)],
                "alpha": [0.0001, 0.001],
                "learning_rate": ["constant", "adaptive"],
                "early_stopping": [True],
                "max_iter": [600, 1000]
            },
            # lbfgs without early stopping
            {
                "solver": ["lbfgs"],
                "activation": ["relu", "tanh"],
                "hidden_layer_sizes": [(50,), (100,)],
                "alpha": [0.0001, 0.001],
                "max_iter": [600, 1000]
            }
        ],
        "SVC": [
            {"kernel": ["linear"], "C": [0.01, 0.1, 1.0, 10.0]},
            {"kernel": ["rbf", "sigmoid"], "C": [0.01, 0.1, 1.0, 10.0], "gamma": ["scale", "auto"]},
            {"kernel": ["poly"], "C": [0.01, 0.1, 1.0, 10.0], "degree": [3, 4], "gamma": ["scale", "auto"]}
        ]
    }
    return params

# ------------- Helper to load various tabular formats -------------

def load_table(file_path, header_only: bool = False):
    """Load tabular data from many file formats (csv, tsv, txt, xlsx, gz, zip).

    Parameters
    ----------
    file_path : str
        Path to the input file.
    header_only : bool, default False
        If True, return only the column headers (no data rows). Helpful when we
        only need the column list.

    Returns
    -------
    pandas.DataFrame
        Loaded dataframe (may be empty when *header_only* is True).
    """
    import pandas as pd  # local import to avoid circular issues

    # Detect compression and true extension (handle double extensions like .csv.gz)
    compression = None
    ext = os.path.splitext(file_path)[1].lower()
    base_no_comp, second_ext = os.path.splitext(os.path.splitext(file_path)[0])

    if ext == '.gz':
        compression = 'gzip'
        ext = second_ext.lower()  # real extension before .gz
    elif ext == '.zip':
        compression = 'zip'
        # inside-zip extension may vary; we let pandas auto-detect separator

    # Decide separator for text formats
    sep = ','  # default
    if ext in ['.tsv', '.txt']:
        sep = '\t'

    try:
        if ext == '.xlsx':
            # Excel file
            df = pd.read_excel(file_path, nrows=0 if header_only else None)
        else:
            # CSV / TSV / TXT (possibly compressed)
            df = pd.read_csv(
                file_path,
                sep=sep,
                engine='python',
                on_bad_lines='skip',
                compression=compression,
                nrows=0 if header_only else None
            )
    except Exception as e:
        # Re-raise as our custom exception for consistency
        raise CustomException(e, sys)

    return df
# ------------- End helper -------------



# Load general packages
import pandas as pd
import numpy as np
import os
from tqdm.notebook import tqdm

# Load sklearn packages
from sklearn.preprocessing import LabelEncoder, OneHotEncoder, StandardScaler
from xgboost import XGBClassifier
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn import set_config

# Load visualization packages
import seaborn as sns
import matplotlib.pyplot as plt
from matplotlib.pyplot import figure

# Load specialized packages
import shap

# Load Custom Modules
from modules.utils import save_json, load_json, getparams
from modules.exception import CustomException
from modules.logger import logging

# Set sklearn configuration
set_config(transform_output="pandas")  # Set SHAP output format to pandas DataFrame for easier manipulation


class SHAP_Analysis:
    """
    This class is responsible for performing SHAP analysis and creating various visualization plots.

    Attributes:
    -----------
    X : pd.DataFrame
        The feature matrix used for model training and SHAP analysis.
    y : pd.Series or np.array
        The target labels corresponding to the feature matrix X.
    outdir : str
        The directory where output plots and files will be saved.
    random_samples : dict
        A dictionary containing random sample indices for different classes.
    biomarker_type : str
        The type of biomarker being analyzed (e.g., microRNA, gene, metabolite).
    shap_values : np.array
        The SHAP values computed for the feature matrix X.
    fitted_model : XGBClassifier
        The trained model used to generate SHAP values.
    scoring : str
        The scoring metric used for model evaluation. Options include "f1", "recall", "precision", "accuracy".
    feature_map_reverse : dict
        A mapping of feature names to their original names.
    model_finetune : bool
        Indicates whether to fine-tune the model.
    fine_tune_cv_nfolds : int
        The number of folds to use for cross-validation during model fine-tuning.
    top_features_to_plot : int 
        The number of features to display on plots

    Methods:
    --------
    shapWaterFall():
        Plots a waterfall plot for both control and disease samples side by side.
    
    shapForce():
        Plots force plots for two random samples from different classes.
    
    shapSummary():
        Creates and saves a SHAP summary plot.
    
    shapHeatmap():
        Creates and saves a SHAP heatmap plot.
    
    shapFeatureImportance():
        Computes and returns the top differentiating features based on SHAP values.
    """

    def __init__(self, 
                 X=None, 
                 y=None, 
                 outdir: str = "shap", 
                 random_samples: dict = None,
                 feature_type: str = "microRNA",
                 feature_map_reverse:dict = None,
                 model_finetune:bool = False,
                 fine_tune_cv_nfolds:int = 5,
                 scoring:str = "f1",
                 top_features_to_plot:int = 20,
                 trained_models_info:dict = None,
                 class_names: list = None,
                 preprocessor: object = None
                ):

        """
        Initializes the SHAP_Analysis object with the provided parameters.

        Parameters:
        -----------
        X : pd.DataFrame, optional
            The feature matrix used for model training and SHAP analysis.
        y : pd.Series or np.array, optional
            The target labels corresponding to the feature matrix X.
        outdir : str, optional
            The directory where output plots and files will be saved. Default is "shap".
        random_samples : dict, optional
            A dictionary containing random sample indices for different classes.
        feature_type : str, optional
            The type of feature being analyzed (e.g., microRNA, gene, metabolite). Default is "microRNA".
        feature_map_reverse : dict, optional
            A mapping of feature names to their original names.
        model_finetune : bool, optional
            Indicates whether to fine-tune the model. Default is False.
        fine_tune_cv_nfolds : int, optional
            The number of folds to use for cross-validation during model fine-tuning. Default is 5.
        scoring : str, optional
            The scoring metric used for model evaluation. Options include "f1", "recall", "precision", "accuracy". Default is "f1".
        top_features_to_plot : int, optional
            The number of features to display per plot.
        """
        self.X = X
        self.y = y
        self.random_samples = random_samples
        self.outdir = outdir
        self.feature_type = feature_type
        self.feature_map_reverse = feature_map_reverse
        self.model_finetune =  model_finetune
        self.fine_tune_cv_nfolds = fine_tune_cv_nfolds
        self.scoring = scoring
        self.top_features_to_plot = top_features_to_plot
        self.trained_models_info = trained_models_info
        self.class_names = class_names
        self.preprocessor = preprocessor

    def fit(self):
        """
        Fit the model and initialize the SHAP explainer. (Model-Agnostic Path)
        """
        if self.trained_models_info:
            model_key = list(self.trained_models_info.keys())[0]
            logging.info(f"Using pre-trained model for SHAP Analysis: {model_key}")
            self.fitted_model = self.trained_models_info[model_key]['model']
        else:
            raise ValueError("SHAP analysis requires a pre-trained classification model, but none was provided.")
        
        if self.preprocessor is None:
            raise ValueError("SHAP analysis in V2 pipeline requires a 'preprocessor' object, but none was provided.")

        X_processed_background = self.preprocessor.transform(self.X)
        logging.info(f"Initializing SHAP Explainer for {model_key} using processed data")

        try:
            explainer = shap.Explainer(self.fitted_model, X_processed_background)
            self.shap_values = explainer(X_processed_background)
        except Exception:
            predict_fn = getattr(self.fitted_model, 'predict_proba', None) or getattr(self.fitted_model, 'predict', None)
            if predict_fn is None: raise
            explainer = shap.Explainer(predict_fn, X_processed_background)
            self.shap_values = explainer(X_processed_background)
        
        # --- İSİM DÜZELTME KISMI (GÜNCELLENDİ) ---
        try:
            processed_feature_names = []
            
            # 1. Preprocessor'dan ham çıktı isimlerini al
            if hasattr(self.preprocessor, "get_feature_names_out"):
                raw_names = self.preprocessor.get_feature_names_out()
            elif hasattr(X_processed_background, "columns"):
                raw_names = X_processed_background.columns
            else:
                raw_names = [f"Feature {i}" for i in range(X_processed_background.shape[1])]

            # 2. İsimleri Temizle ve Eşleştir
            for name in raw_names:
                # A) Prefix temizliği: 'num_pipeline__Feature_1' -> 'Feature_1'
                # Eğer isimde '__' varsa, son parçayı al.
                clean_name = name.split("__")[-1] if "__" in name else name
                
                # B) Mapping kontrolü: Eğer clean_name sözlükte varsa gerçek ismini al
                # Örn: feature_map_reverse = {'Feature_1': 'Age'} ise 'Age' olur.
                if self.feature_map_reverse:
                     final_name = self.feature_map_reverse.get(clean_name, clean_name)
                else:
                     final_name = clean_name
                
                processed_feature_names.append(final_name)

            # 3. SHAP objesine ata
            self.shap_values.feature_names = processed_feature_names
            
        except Exception as e:
            logging.error(f"Error assigning feature names: {str(e)}")
            self.shap_values.feature_names = [f"Feature {i}" for i in range(X_processed_background.shape[1])]

    def _check_fit(self):
        """
        Checks if the model is fitted and the SHAP explainer is initialized.
        If not, it calls the fit method to train the model.
        """
        if not hasattr(self, 'shap_values') or self.shap_values is None: # Ensure SHAP values are computed before plotting
            logging.info("Training Model for SHAP Analysis")
            self.fit()
            
    def shapWaterFall(self):
        self._check_fit()
        logging.info("Plotting Waterfall Plots")
        
        # Create a figure with two subplots side-by-side
        fig, axes = plt.subplots(1, 2, figsize=(20, 10))
        class_names = list(self.random_samples.keys())

        # --- Plot for the first class (e.g., AD) ---
        class_name_1 = class_names[0]
        sample_index_1 = self.random_samples[class_name_1]

        # Select the correct slice of SHAP values based on dimensionality
        if len(self.shap_values.shape) > 2 and self.shap_values.shape[2] > 1:
            class_index_1 = self.class_names.index(class_name_1)
            shap_values_for_plot_1 = self.shap_values[sample_index_1, :, class_index_1]
        else:
            shap_values_for_plot_1 = self.shap_values[sample_index_1]
        
        # Plot on the first axis
        plt.sca(axes[0])
        shap.plots.waterfall(shap_values_for_plot_1, max_display=self.top_features_to_plot, show=False)
        axes[0].set_title(f"{class_name_1} Sample", fontsize=15)

        # --- Plot for the second class (e.g., Control) ---
        class_name_2 = class_names[1]
        sample_index_2 = self.random_samples[class_name_2]

        # Select the correct slice of SHAP values
        if len(self.shap_values.shape) > 2 and self.shap_values.shape[2] > 1:
            class_index_2 = self.class_names.index(class_name_2)
            shap_values_for_plot_2 = self.shap_values[sample_index_2, :, class_index_2]
        else:
            shap_values_for_plot_2 = self.shap_values[sample_index_2]
            
        # Plot on the second axis
        plt.sca(axes[1])
        shap.plots.waterfall(shap_values_for_plot_2, max_display=self.top_features_to_plot, show=False)
        axes[1].set_title(f"{class_name_2} Sample", fontsize=15)

        # --- Finalize and save the combined plot ---
        plt.tight_layout(pad=2.0)
        plt.suptitle(f"Waterfall Plots for {class_name_1} and {class_name_2} Samples", fontsize=20, y=1.02)
        
        logging.info("Saving Plots")
        plot_path_png = f'{self.outdir}/png/shap_waterfall_subplots_{class_name_1}_and_{class_name_2}.png'
        plot_path_pdf = f'{self.outdir}/pdf/shap_waterfall_subplots_{class_name_1}_and_{class_name_2}.pdf'
        plt.savefig(plot_path_png, bbox_inches='tight')
        plt.savefig(plot_path_pdf, bbox_inches='tight')
        plt.close()
        print(plot_path_png)

    def shapForce(self):
        self._check_fit()
        class_names = list(self.random_samples.keys())
        # create a new plot for each class
        for i in range(len(class_names)):

             # Get the index of the current class as the model sees it
            try:
                # Get the index of the current class name from the list of class names provided during initialization
                class_index = list(self.class_names).index(class_names[i])
            except (AttributeError, ValueError):
                class_index = 0
            
            sample_index = self.random_samples[class_names[i]]

            # Select the specific explanation for the current sample and class
            if len(self.shap_values.shape) > 2 and self.shap_values.shape[2] > 1:
                shap_values_for_plot = self.shap_values[sample_index, :, class_index]
            else: # e.g., (samples, features)
                shap_values_for_plot = self.shap_values[sample_index]

            shap.force_plot(shap_values_for_plot, matplotlib=True, show=False)
            # Move title to figure-level to avoid overlapping with plot content
            fig = plt.gcf()
            fig.suptitle(f'SHAP Force Plot for a random {class_names[i]} sample', fontsize=20)
            # Reserve space on top for the suptitle
            plt.tight_layout(rect=[0, 0, 1, 0.95])
            plt.savefig(f'{self.outdir}/png/forceplot_for_{class_names[i]}_sample.png', bbox_inches='tight')
            plt.savefig(f'{self.outdir}/pdf/forceplot_for_{class_names[i]}_sample.pdf', bbox_inches='tight')
            print(f'{self.outdir}/png/forceplot_for_{class_names[i]}_sample.png')
            #plt.show()
    
    def shapForcePlot(self):
        self._check_fit()
        class_names = list(self.random_samples.keys())
        # create a new plot for each class
        for i in range(len(class_names)):

             # Get the index of the current class as the model sees it
            try:
                # Get the index of the current class name from the list of class names provided during initialization
                class_index = list(self.class_names).index(class_names[i])
            except (AttributeError, ValueError):
                class_index = 0
            
            sample_index = self.random_samples[class_names[i]]

            # Select the specific explanation for the current sample and class
            if len(self.shap_values.shape) > 2 and self.shap_values.shape[2] > 1:
                shap_values_for_plot = self.shap_values[sample_index, :, class_index]
            else: # e.g., (samples, features)
                shap_values_for_plot = self.shap_values[sample_index]

            # Pass figsize and move title to figure-level to prevent overlap
            shap.force_plot(shap_values_for_plot, matplotlib=True, show=False, figsize=(20, 5))
            fig = plt.gcf()
            fig.suptitle(f'SHAP Force Plot for a random {class_names[i]} sample', fontsize=16)
            # Leave space at the top for the suptitle
            plt.tight_layout(rect=[0, 0, 1, 0.94])

            plot_path_png = f'{self.outdir}/png/forceplot_for_{class_names[i]}_sample.png'
            plot_path_pdf = f'{self.outdir}/pdf/forceplot_for_{class_names[i]}_sample.pdf'
            plt.savefig(plot_path_png, bbox_inches='tight')
            plt.savefig(plot_path_pdf, bbox_inches='tight')
            
            print(plot_path_png)
            plt.close() # Important: close the figure to free memory and prevent state leakage
    
    def shapSummary(self):
        """
        Plot a SHAP summary plot. For multi-class outputs, it plots for each class side-by-side.
        """
        self._check_fit()
        logging.info("Plotting SHAP Summary Plot")

        # Ham self.X yerine, modelin gördüğü işlenmiş (transformed) veriyi hazırlıyoruz.
        # shap_values bu yapıya göre hesaplandığı için matris boyutları artık tutacaktır.
        X_transformed = self.preprocessor.transform(self.X)
        # -----------------------

        # Handle multi-class models by creating subplots
        if len(self.shap_values.shape) > 2 and self.shap_values.shape[2] > 1:
            fig, axes = plt.subplots(1, 2, figsize=(20, 10))
            class_names = self.class_names
            
            # --- Plot for the first class ---
            plt.sca(axes[0])
            # self.X yerine X_transformed kullanıyoruz
            shap.summary_plot(self.shap_values[:,:,0], X_transformed, show=False)
            axes[0].set_title(f"SHAP Summary for {class_names[0]}", fontsize=15)

            # --- Plot for the second class ---
            plt.sca(axes[1])
            # self.X yerine X_transformed kullanıyoruz
            shap.summary_plot(self.shap_values[:,:,1], X_transformed, show=False)
            axes[1].set_title(f"SHAP Summary for {class_names[1]}", fontsize=15)
            
            # --- Finalize and save the combined plot ---
            plt.tight_layout(pad=1.0)
            plot_path_png = f'{self.outdir}/png/shap_summary_plot_subplots.png'
            plot_path_pdf = f'{self.outdir}/pdf/shap_summary_plot_subplots.pdf'
            plt.savefig(plot_path_png, bbox_inches='tight')
            plt.savefig(plot_path_pdf, bbox_inches='tight')
            plt.close()
            print(plot_path_png)
        else:
            # This handles single-output models
            plt.figure()
            # self.X yerine X_transformed kullanıyoruz
            shap.summary_plot(self.shap_values, X_transformed, show=False)
            plt.title("SHAP Summary Plot")
            plot_path_png = f'{self.outdir}/png/shap_summary_plot_overall.png'
            plot_path_pdf = f'{self.outdir}/pdf/shap_summary_plot_overall.pdf'
            plt.savefig(plot_path_png, bbox_inches='tight')
            plt.savefig(plot_path_pdf, bbox_inches='tight')
            plt.close()
            print(plot_path_png)

    def shapHeatmap(self):
        """
        Create and save a SHAP heatmap plot. For multi-class, creates a vertical subplot per class.
        """
        self._check_fit()
        logging.info("Plotting SHAP Heatmap")

        # Handle multi-class models by creating vertical subplots
        if len(self.shap_values.shape) > 2 and self.shap_values.shape[2] > 1:
            fig, axes = plt.subplots(2, 1, figsize=(20, 40)) # Vertical arrangement
            class_names = self.class_names

            # --- Plot for the first class ---
            plt.sca(axes[0])
            shap.plots.heatmap(self.shap_values[:,:,0], max_display=self.top_features_to_plot, show=False, plot_width=20)
            axes[0].set_title(f"SHAP Heatmap for {class_names[0]}", fontsize=20)
            
            # --- Plot for the second class ---
            plt.sca(axes[1])
            shap.plots.heatmap(self.shap_values[:,:,1], max_display=self.top_features_to_plot, show=False, plot_width=20)
            axes[1].set_title(f"SHAP Heatmap for {class_names[1]}", fontsize=20)
            
            # --- Finalize and save ---
            plt.tight_layout(pad=3.0)
            plot_path_png = f'{self.outdir}/png/shap_heatmap_subplots.png'
            plot_path_pdf = f'{self.outdir}/pdf/shap_heatmap_subplots.pdf'
            plt.savefig(plot_path_png, bbox_inches='tight')
            plt.savefig(plot_path_pdf, bbox_inches='tight')
            plt.close()
            print(plot_path_png)
        else:
            # Handle single-output models
            plt.figure(figsize=(18, 40), dpi=300)
            shap.plots.heatmap(self.shap_values, max_display=self.top_features_to_plot, show=False, plot_width=20)
            plt.title(f"SHAP Heatmap of Top Differentiating {self.feature_type}s", fontsize=25, loc='center', pad=20)
            plt.xlabel('Instances', fontsize=20); plt.xticks(fontsize=18); plt.yticks(fontsize=18)
            plot_path_png = f'{self.outdir}/png/shap_heatmap_plot_overall.png'
            plot_path_pdf = f'{self.outdir}/pdf/shap_heatmap_plot_overall.pdf'
            plt.savefig(plot_path_png, bbox_inches='tight')
            plt.savefig(plot_path_pdf, bbox_inches='tight')
            plt.close()
            print(plot_path_png)

    def meanSHAP(self):
        """
        Create and save a mean SHAP plot (bar plot). For multi-class, creates a side-by-side plot per class.
        """
        self._check_fit()
        logging.info("Plotting Mean SHAP Plot")

        if len(self.shap_values.shape) > 2 and self.shap_values.shape[2] > 1:
            fig, axes = plt.subplots(1, 2, figsize=(20, 10))
            class_names = self.class_names

            # --- Plot for the first class ---
            plt.sca(axes[0])
            shap.plots.bar(self.shap_values[:,:,0], max_display=self.top_features_to_plot, show=False)
            axes[0].set_title(f"Mean SHAP for {class_names[0]}", fontsize=15)

            # --- Plot for the second class ---
            plt.sca(axes[1])
            shap.plots.bar(self.shap_values[:,:,1], max_display=self.top_features_to_plot, show=False)
            axes[1].set_title(f"Mean SHAP for {class_names[1]}", fontsize=15)

            # --- Finalize and save ---
            plt.tight_layout(pad=1.0)
            plot_path_png = f'{self.outdir}/png/mean_shap_plot_subplots.png'
            plot_path_pdf = f'{self.outdir}/pdf/mean_shap_plot_subplots.pdf'
            plt.savefig(plot_path_png, bbox_inches='tight')
            plt.savefig(plot_path_pdf, bbox_inches='tight')
            plt.close()
            print(plot_path_png)

            # Additionally, create a single global bar using mean(|SHAP|) aggregated across classes
            try:
                shap_v = self.shap_values.values if hasattr(self.shap_values, 'values') else self.shap_values
                # Aggregate: mean over samples of mean absolute SHAP over classes
                global_importance = np.mean(np.abs(shap_v), axis=0).mean(axis=1)
                # Yeni Doğru Kod: shap_values içindeki doğru feature isimlerini kullan
                if hasattr(self.shap_values, "feature_names") and self.shap_values.feature_names:
                    feature_names = self.shap_values.feature_names
                else:
                    try:
                        feature_names = list(self.preprocessor.get_feature_names_out())
                    except Exception:
                        feature_names = [f"Feature {i}" for i in range(len(global_importance))]
                # Clean transformer prefixes and map back to original names when possible
                cleaned = []
                for name in feature_names:
                    base = name.split("__")[-1] if isinstance(name, str) and "__" in name else name
                    if isinstance(base, str) and self.feature_map_reverse:
                        cleaned.append(self.feature_map_reverse.get(base, base))
                    else:
                        cleaned.append(base)
                feature_names = cleaned
                # -----------------------

                importance_df = pd.DataFrame({
                    'feature': feature_names,
                    'importance': global_importance
                }).sort_values('importance', ascending=False).head(self.top_features_to_plot)

                plt.figure(figsize=(8, 6), dpi=300)
                plt.barh(importance_df['feature'][::-1], importance_df['importance'][::-1])
                plt.title(f"Global Mean |SHAP| of Top Differentiating {self.feature_type}s", fontsize=20, loc='center', pad=20)
                plt.xlabel('mean(|SHAP value|)', fontsize=20); plt.xticks(fontsize=18); plt.yticks(fontsize=18)
                plot_path_png_global = f'{self.outdir}/png/mean_shap_plot_overall.png'
                plot_path_pdf_global = f'{self.outdir}/pdf/mean_shap_plot_overall.pdf'
                plt.savefig(plot_path_png_global, bbox_inches='tight')
                plt.savefig(plot_path_pdf_global, bbox_inches='tight')
                plt.close()
                print(plot_path_png_global)
            except Exception as e:
                # Hata logunu görebilmek için pass yerine loglamak daha iyidir
                logging.warning(f"Could not plot Global Mean SHAP: {str(e)}")
                pass
        else:
            plt.figure(figsize=(8, 6), dpi=300)
            shap.plots.bar(self.shap_values, max_display=self.top_features_to_plot, show=False)
            plt.title(f"Mean SHAP Plot of Top Differentiating {self.feature_type}s", fontsize=20, loc='center', pad=20)
            plt.xlabel('mean(|SHAP value|)', fontsize=20); plt.xticks(fontsize=18); plt.yticks(fontsize=18)
            plot_path_png = f'{self.outdir}/png/mean_shap_plot_overall.png'
            plot_path_pdf = f'{self.outdir}/pdf/mean_shap_plot_overall.pdf'
            plt.savefig(plot_path_png, bbox_inches='tight')
            plt.savefig(plot_path_pdf, bbox_inches='tight')
            plt.close()
            print(plot_path_png)

    def shapFeatureImportance(self):
        """
        Compute and return the top differentiating features based on SHAP values.
        For multi-class models, it aggregates importances across all classes.
        """
        self._check_fit()
        logging.info("Computing SHAP Feature Importances")

        shap_v = self.shap_values.values if hasattr(self.shap_values, 'values') else self.shap_values
        
        # Handle multi-class and single-class explanations differently
        if len(shap_v.shape) > 2 and shap_v.shape[2] > 1:
            # For multi-class, average the absolute SHAP values over samples and then classes
            # to get a single global importance value for each feature.
            shap_importance_values = np.mean(np.abs(shap_v), axis=0).mean(axis=1)
        else:
            # For single-class, just average the absolute SHAP values over samples
            shap_importance_values = np.mean(np.abs(shap_v), axis=0)

        # YENİ: Özellik isimlerini doğrudan SHAP objesinden alıyoruz (çünkü fit() metodunda bunları doğru ayarlamıştık)
        # Eğer fit() metodundaki düzeltmeyi yaptıysanız feature_names burada hazırdır.
        if hasattr(self.shap_values, "feature_names") and self.shap_values.feature_names:
             feature_names_list = list(self.shap_values.feature_names)
        else:
             # Güvenlik önlemi: Eğer shap_values içinde isim yoksa preprocessor'dan iste
             try:
                 feature_names_list = list(self.preprocessor.get_feature_names_out())
             except Exception:
                 feature_names_list = [f"Feature {i}" for i in range(len(shap_importance_values))]
        # Transformer prefix temizliği ve orijinal isme dönüş
        processed_names = []
        for name in feature_names_list:
            base = name.split("__")[-1] if isinstance(name, str) and "__" in name else name
            if isinstance(base, str) and self.feature_map_reverse:
                processed_names.append(self.feature_map_reverse.get(base, base))
            else:
                processed_names.append(base)
        feature_names_list = processed_names
        
        shap_values_df = pd.DataFrame({
            'feature': feature_names_list,  # self.X.columns yerine bunu kullanıyoruz
            'importance': shap_importance_values
        }).sort_values('importance', ascending=False)
        # -----------------------
        
        top_features = {row.feature: row.importance for index, row in shap_values_df.iterrows()}

        return top_features
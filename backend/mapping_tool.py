import cv2
import json
import os

# --- CONFIGURATION ---
IMAGE_PATH = 'backend/data/output/temp/pdf_images/Bulletin_du_30_Octobre_2025_12h00_prevision_1.png' 
OUTPUT_JSON = 'backend/config_roi.json'

STATIONS = [
    "Ouagadougou", "Bobo-Dioulasso", "Dori", 
    "Fada N'Gourma", "Ouahigouya", "Dédougou", "Boromo", 
    "Gaoua", "Pô", "Bogandé"
]

INFO_TYPE = {
    "tmin": {"label": "T-MIN (Temp Basse - Bleu)", "color": (255, 0, 0)},   # Bleu (BGR)
    "tmax": {"label": "T-MAX (Temp Haute - Rouge)", "color": (0, 0, 255)},  # Rouge (BGR)
    "icon": {"label": "ICONE (Le dessin)", "color": (0, 200, 0)}           # Vert (BGR)
}

def create_mapping():
    if not os.path.exists(IMAGE_PATH):
        print(f"ERREUR: L'image {IMAGE_PATH} est introuvable.")
        return

    img_original = cv2.imread(IMAGE_PATH)
    if img_original is None:
        print("Erreur lecture image.")
        return

    h_orig, w_orig = img_original.shape[:2]
    
    # Redimensionnement intelligent pour l'écran
    HAUTEUR_ECRAN_MAX = 1000 
    scale_factor = 1.0
    if h_orig > HAUTEUR_ECRAN_MAX:
        scale_factor = HAUTEUR_ECRAN_MAX / h_orig
        new_w = int(w_orig * scale_factor)
        new_h = int(h_orig * scale_factor)
        img_base_display = cv2.resize(img_original, (new_w, new_h))
    else:
        img_base_display = img_original.copy()

    config = {} # Le dictionnaire global qui stockera tout
    


    for station in STATIONS:
        station_config = {} # Dictionnaire temporaire pour UNE station
        
        for data_key, info in INFO_TYPE.items():
            # Préparer l'image avec les instructions
            img_prompt = img_base_display.copy()
            
            # Dessin du bandeau et du texte
            cv2.rectangle(img_prompt, (0, 0), (img_prompt.shape[1], 80), (255, 255, 255), -1)
            cv2.putText(img_prompt, f"STATION : {station.upper()}", (20, 30), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
            cv2.putText(img_prompt, f"CIBLE : {info['label']}", (20, 65), 
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, info['color'], 3)
            cv2.putText(img_prompt, "ESPACE: Valider | C: Annuler", (img_prompt.shape[1] - 350, 50), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (100, 100, 100), 1)

            # Sélection
            window_name = "Outil de Mapping Meteo"
            roi = cv2.selectROI(window_name, img_prompt, showCrosshair=True, fromCenter=False)
            
            if roi == (0,0,0,0):
                print(f" -> {station} ({data_key}): Ignoré")
                station_config[f"{data_key}_roi"] = None
            else:
                x_disp, y_disp, w_disp, h_disp = roi
                
                # Conversion échelle écran -> échelle réelle
                x1 = int(x_disp / scale_factor)
                y1 = int(y_disp / scale_factor)
                x2 = int((x_disp + w_disp) / scale_factor)
                y2 = int((y_disp + h_disp) / scale_factor)

                # Agrandir la zone de 10 px de chaque côté (icône + valeurs)
                margin = 10
                x1 -= margin
                y1 -= margin
                x2 += margin
                y2 += margin
                
                # Sécurité
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w_orig, x2), min(h_orig, y2)

                station_config[f"{data_key}_roi"] = [x1, y1, x2, y2]
                print(f" -> {station} ({data_key}): OK")

        # === LA LIGNE QUI MANQUAIT ÉTAIT ICI ===
        # On ajoute la station complétée au dictionnaire global
        config[station] = station_config 
        # ========================================

    cv2.destroyAllWindows()
    
    # Sauvegarde finale
    with open(OUTPUT_JSON, 'w') as f:
        json.dump(config, f, indent=4)
    print(f"\nSuccès ! Configuration sauvegardée dans {OUTPUT_JSON} (Vérifiez sa taille maintenant !)")

if __name__ == "__main__":
    create_mapping()

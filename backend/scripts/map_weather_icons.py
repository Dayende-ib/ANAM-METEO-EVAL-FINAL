#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Associe les icônes météo extraites avec les codes de pictogrammes standards."""

import json
from collections import Counter
from pathlib import Path


def extract_weather_icons_from_json(json_file_path):
    """Extrait les valeurs weather_icon d'un fichier JSON."""
    weather_icons = []
    
    try:
        with open(json_file_path, 'r', encoding='utf-8') as file:
            data = json.load(file)
            
        # Vérifier si la clé 'stations' existe
        if 'stations' in data:
            for station in data['stations']:
                if 'weather_icon' in station:
                    weather_icons.append(station['weather_icon'])
                    
    except (json.JSONDecodeError, FileNotFoundError, KeyError) as e:
        print(f"Erreur lors de la lecture du fichier {json_file_path}: {e}")
        
    return weather_icons


def map_weather_icons_to_codes(weather_icons):
    """Associe les icônes météo aux codes de pictogrammes standards."""
    
    # Mapping des icônes vers les codes de pictogrammes
    icon_to_code = {
        # Pictogrammes météo standards
        "partiellement_nuageux": "NSW",
        "nuageux": "NSW",
        "ensoleille": "NSW",
        "pluie": "RA",
        "pluies orageuses isolées": "TSRA",
        "pluies orageuses isolees": "TSRA",
        "Pluie orageuse": "TSRA",
        "orage": "TS",
        "Orages isoles": "TS",
        
        # Pictogrammes avec poussière
        "Poussière en suspension": "DU",
        "Ciel couvert avec poussière": "DU",
        "Ciel nuageux avec poussière": "DU",
        "Temps partiellement nuageux": "DU",
        
        # Autres icônes spécifiques
        "Ciel couvert": "NSW",
        "Ciel dégagé": "NSW"
    }
    
    # Compter les occurrences des icônes originales
    icon_counts = Counter(weather_icons)
    
    # Créer un mapping des codes aux icônes
    code_to_icons = {}
    for icon, code in icon_to_code.items():
        if code not in code_to_icons:
            code_to_icons[code] = []
        if icon not in code_to_icons[code]:
            code_to_icons[code].append(icon)
    
    # Compter les occurrences des codes
    code_counts = Counter()
    for icon, count in icon_counts.items():
        if icon in icon_to_code:
            code = icon_to_code[icon]
            code_counts[code] += count
        elif icon == "":
            code_counts["VIDE"] = code_counts.get("VIDE", 0) + count
        else:
            code_counts[f"NON_ASSOCIE ({icon})"] = code_counts.get(f"NON_ASSOCIE ({icon})", 0) + count
    
    return icon_counts, code_counts, code_to_icons


def main():
    """Fonction principale pour parcourir les fichiers JSON et faire la correspondance."""
    base_path = Path("e:/Documents/GitHub/ANAM-METEO-EVAL-FINAL/backend/json")
    
    # Liste pour stocker toutes les valeurs weather_icon trouvées
    all_weather_icons = []
    
    # Parcourir les sous-répertoires JUILLET et Mars
    for subdir in ['JUILLET', 'Mars']:
        subdir_path = base_path / subdir
        
        if subdir_path.exists():
            # Parcourir tous les fichiers JSON dans le sous-répertoire
            for json_file in subdir_path.glob("*.json"):
                icons = extract_weather_icons_from_json(json_file)
                all_weather_icons.extend(icons)
    
    # Faire la correspondance avec les codes de pictogrammes
    icon_counts, code_counts, code_to_icons = map_weather_icons_to_codes(all_weather_icons)
    
    print("=== CORRESPONDANCE DES ICÔNES MÉTÉO AVEC LES CODES DE PICTOGRAMMES ===\n")
    
    print("ICÔNES MÉTÉO ORIGINALES TROUVÉES:")
    print("-" * 40)
    for icon, count in sorted(icon_counts.items(), key=lambda x: x[1], reverse=True):
        if icon == "":
            print(f"- '{icon}' (vide): {count} occurrence(s)")
        else:
            print(f"- {icon}: {count} occurrence(s)")
    
    print(f"\nTOTAL D'ICÔNES MÉTÉO ORIGINALES: {len(all_weather_icons)}")
    
    print("\n\nCORRESPONDANCE AVEC LES CODES DE PICTOGRAMMES:")
    print("-" * 50)
    for code in sorted(code_counts.keys()):
        count = code_counts[code]
        if code.startswith("NON_ASSOCIE"):
            print(f"\n{code}: {count} occurrence(s)")
        elif code == "VIDE":
            print(f"\nVIDE (données manquantes): {count} occurrence(s)")
        else:
            print(f"\nCode {code}: {count} occurrence(s)")
            if code in code_to_icons:
                print(f"  Correspond aux icônes: {', '.join(code_to_icons[code])}")
    
    print(f"\nTOTAL DE CODES ASSOCIÉS: {sum(count for code, count in code_counts.items() if not code.startswith('NON_ASSOCIE') and code != 'VIDE')}")
    print(f"TOTAL DE DONNÉES NON ASSOCIÉES: {code_counts.get('VIDE', 0) + sum(count for code, count in code_counts.items() if code.startswith('NON_ASSOCIE'))}")
    
    print("\n\nRÉSUMÉ PAR CATÉGORIE DE PICTOGRAMME:")
    print("-" * 40)
    
    # Calculer les totaux par catégorie
    standard_codes = ['TSRA', 'RA', 'TS', 'NSW']
    dust_codes = ['DUTSRA', 'DURA', 'DUTS', 'DU']
    
    standard_total = sum(code_counts.get(code, 0) for code in standard_codes)
    dust_total = sum(code_counts.get(code, 0) for code in dust_codes)
    
    print(f"Pictogrammes météo standards: {standard_total}")
    print(f"Pictogrammes avec poussière: {dust_total}")
    print(f"Données manquantes ou non associées: {code_counts.get('VIDE', 0) + sum(count for code, count in code_counts.items() if code.startswith('NON_ASSOCIE'))}")


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Normalise les icÃ´nes mÃ©tÃ©o et les associe aux codes de pictogrammes standards."""

import json
import unicodedata
from collections import Counter
from pathlib import Path


def normalize_text(text):
    """Supprime les accents et normalise le texte."""
    # Convertir en minuscules et supprimer les accents
    normalized = unicodedata.normalize('NFD', text.lower())
    normalized = ''.join(char for char in normalized if unicodedata.category(char) != 'Mn')
    return normalized


def extract_weather_icons_from_json(json_file_path):
    """Extrait les valeurs weather_icon d'un fichier JSON."""
    weather_icons = []
    
    try:
        with open(json_file_path, 'r', encoding='utf-8') as file:
            data = json.load(file)
            
        # VÃ©rifier si la clÃ© 'stations' existe
        if 'stations' in data:
            for station in data['stations']:
                if 'weather_icon' in station:
                    weather_icons.append(station['weather_icon'])
                    
    except (json.JSONDecodeError, FileNotFoundError, KeyError) as e:
        print(f"Erreur lors de la lecture du fichier {json_file_path}: {e}")
        
    return weather_icons


def create_normalized_mapping():
    """CrÃ©e le mapping normalisÃ© entre les icÃ´nes et les codes de pictogrammes."""
    
    # Mapping des icÃ´nes normalisÃ©es vers les codes de pictogrammes
    # Selon les associations spÃ©cifiques demandÃ©es
    normalized_icon_to_code = {
        # Pictogrammes météo standards
        "orages avec pluies isoles": "TSRA",
        "orages avec pluies": "TSRA",
        "pluies": "RA",
        "orages": "TS",
        "orages isoles": "TS",
        "temps partiellement nuageux": "NSW",
        "temps nuageux": "NSW",
        "temps ensoleille": "NSW",

        # Pictogrammes avec poussière
        "orages avec pluies isoles avec poussiere": "DUTSRA",
        "pluies avec poussiere": "DURA",
        "orages isoles avec poussiere": "DUTS",
        "orages avec poussiere": "DUTS",
        "temps partiellement nuageux avec poussiere": "DU",
        "temps nuageux avec poussiere": "DU",
        "temps ensoleille avec poussiere": "DU",
        "poussiere": "DU",
    }
    
    return normalized_icon_to_code


def main():
    """Fonction principale pour analyser les fichiers JSON et crÃ©er la correspondance normalisÃ©e."""
    base_path = Path("e:/Documents/GitHub/ANAM-METEO-EVAL-FINAL/backend/json")
    
    # Liste pour stocker toutes les valeurs weather_icon trouvÃ©es avec leurs occurrences
    all_weather_icons = []
    
    # Parcourir les sous-rÃ©pertoires JUILLET et Mars
    for subdir in ['JUILLET', 'Mars']:
        subdir_path = base_path / subdir
        
        if subdir_path.exists():
            # Parcourir tous les fichiers JSON dans le sous-rÃ©pertoire
            for json_file in subdir_path.glob("*.json"):
                icons = extract_weather_icons_from_json(json_file)
                all_weather_icons.extend(icons)
    
    # Compter les occurrences des icÃ´nes originales
    original_counts = Counter(all_weather_icons)
    
    # CrÃ©er le mapping normalisÃ©
    normalized_icon_to_code = create_normalized_mapping()
    
    # Associer les icÃ´nes normalisÃ©es avec les codes et compter les occurrences
    code_to_icons = {}
    code_counts = Counter()
    
    for icon, count in original_counts.items():
        if icon == "":
            # GÃ©rer les valeurs vides sÃ©parÃ©ment
            code = "VIDE"
            code_counts[code] += count
            if code not in code_to_icons:
                code_to_icons[code] = []
            code_to_icons[code].append((icon, count))
        else:
            # Normaliser l'icÃ´ne
            normalized_icon = normalize_text(icon)
            
            if normalized_icon in normalized_icon_to_code:
                code = normalized_icon_to_code[normalized_icon]
                code_counts[code] += count
                
                # Ajouter l'icÃ´ne originale et sa variante normalisÃ©e
                if code not in code_to_icons:
                    code_to_icons[code] = []
                
                # VÃ©rifier si l'entrÃ©e existe dÃ©jÃ  pour Ã©viter les doublons
                existing_entry = False
                for i, (orig_icon, orig_count) in enumerate(code_to_icons[code]):
                    if normalize_text(orig_icon) == normalized_icon:
                        # Fusionner les occurrences si la variante normalisÃ©e est identique
                        code_to_icons[code][i] = (orig_icon, orig_count + count)
                        existing_entry = True
                        break
                
                if not existing_entry:
                    code_to_icons[code].append((icon, count))
            else:
                # IcÃ´ne non associÃ©e
                code = f"NON_ASSOCIE ({normalized_icon})"
                code_counts[code] += count
                if code not in code_to_icons:
                    code_to_icons[code] = []
                code_to_icons[code].append((icon, count))
    
    print("=== LISTE COMPLÃˆTE DES CODES DE PICTOGRAMMES MÃ‰TÃ‰O AVEC ICÃ”NES ASSOCIÃ‰ES ===\n")
    
    print("ICÃ”NES MÃ‰TÃ‰O ORIGINALES TROUVÃ‰ES:")
    print("-" * 40)
    for icon, count in sorted(original_counts.items(), key=lambda x: x[1], reverse=True):
        if icon == "":
            print(f"- '{icon}' (vide): {count} occurrence(s)")
        else:
            normalized = normalize_text(icon)
            print(f"- {icon} (normalisÃ©: '{normalized}'): {count} occurrence(s)")
    
    print(f"\nTOTAL D'ICÃ”NES MÃ‰TÃ‰O ORIGINALES: {sum(original_counts.values())}")
    
    print("\n\nLISTE DES CODES AVEC LEURS ICÃ”NES MÃ‰TÃ‰O ASSOCIÃ‰ES (TRIÃ‰ES PAR CODE):")
    print("-" * 70)
    
    # Trier les codes pour l'affichage
    for code in sorted(code_counts.keys()):
        count = code_counts[code]
        if code.startswith("NON_ASSOCIE"):
            print(f"\n{code}: {count} occurrence(s)")
            for icon, icon_count in code_to_icons.get(code, []):
                print(f"  - {icon}: {icon_count} occurrence(s)")
        elif code == "VIDE":
            print(f"\nCode {code} (donnÃ©es manquantes): {count} occurrence(s)")
            for icon, icon_count in code_to_icons.get(code, []):
                print(f"  - '{icon}' (vide): {icon_count} occurrence(s)")
        else:
            print(f"\nCode {code}: {count} occurrence(s)")
            for icon, icon_count in code_to_icons.get(code, []):
                print(f"  - {icon}: {icon_count} occurrence(s)")
    
    print(f"\nTOTAL DE CODES ASSOCIÃ‰S: {sum(count for code, count in code_counts.items() if not code.startswith('NON_ASSOCIE') and code != 'VIDE')}")
    print(f"TOTAL DE DONNÃ‰ES NON ASSOCIÃ‰ES: {code_counts.get('VIDE', 0) + sum(count for code, count in code_counts.items() if code.startswith('NON_ASSOCIE'))}")
    
    print("\n\nRÃ‰CAPITULATIF FINAL PAR CODE:")
    print("-" * 40)
    for code in sorted([c for c in code_counts.keys() if not c.startswith('NON_ASSOCIE') and c != 'VIDE']):
        count = code_counts[code]
        print(f"{code}: {count} occurrence(s)")


if __name__ == "__main__":
    main()

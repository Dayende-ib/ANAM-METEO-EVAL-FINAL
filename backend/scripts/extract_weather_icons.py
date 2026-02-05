#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Extrait et regroupe les valeurs de la clé weather_icon dans les fichiers JSON."""

import json
import os
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


def main():
    """Fonction principale pour parcourir les fichiers JSON et extraire les weather_icon."""
    base_path = Path("e:/Documents/GitHub/ANAM-METEO-EVAL-FINAL/backend/json")
    
    # Liste pour stocker toutes les valeurs weather_icon trouvées
    all_weather_icons = []
    
    # Parcourir les sous-répertoires JUILLET et Mars
    for subdir in ['JUILLET', 'Mars']:
        subdir_path = base_path / subdir
        
        if subdir_path.exists():
            # Parcourir tous les fichiers JSON dans le sous-répertoire
            for json_file in subdir_path.glob("*.json"):
                print(f"Traitement du fichier : {json_file.name}")
                icons = extract_weather_icons_from_json(json_file)
                all_weather_icons.extend(icons)
    
    # Compter les occurrences de chaque valeur weather_icon
    icon_counts = Counter(all_weather_icons)
    
    print("\n=== Résultats ===")
    print(f"Nombre total d'icônes météo trouvées : {len(all_weather_icons)}")
    print(f"Nombre d'icônes uniques : {len(icon_counts)}")
    
    print("\nRépartition des icônes météo :")
    for icon, count in sorted(icon_counts.items()):
        print(f"- {icon}: {count} occurrence(s)")
    
    # Afficher la liste des icônes uniques
    print(f"\nListe des icônes météo uniques : {sorted(set(all_weather_icons))}")


if __name__ == "__main__":
    main()
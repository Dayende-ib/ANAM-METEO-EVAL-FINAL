#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script pour utiliser NLLB uniquement en local (sans connexion internet)
Usage: python backend/scripts/run_local_nllb.py "Ma phrase à traduire" --lang moore
"""

import sys
import os
import argparse
import time
from pathlib import Path

# Ajouter le répertoire racine au path pour les imports
root_dir = Path(__file__).resolve().parents[2]
sys.path.append(str(root_dir))

# Charger le fichier .env avant tout
env_path = root_dir / ".env"
if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                if " #" in line:
                    line = line.split(" #", 1)[0].strip()
                key, value = line.split("=", 1)
                os.environ[key.strip()] = value.strip().strip("'").strip('"')

import logging

# Configuration du logging pour voir les messages de LanguageInterpreter
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)

from backend.modules.language_interpreter import LanguageInterpreter

def run_translation():
    parser = argparse.ArgumentParser(description="Traducteur NLLB 100% Local")
    parser.add_argument("text", nargs="?", help="Texte à traduire", default="Bonjour la famille")
    parser.add_argument("--lang", choices=["moore", "dioula", "all"], default="all", help="Langue cible")
    args = parser.parse_args()

    print("\n" + "="*60)
    print("🌍 TRADUCTION NLLB (MODE LOCAL UNIQUEMENT)")
    print("="*60)

    # 1. Initialisation de l'interpréteur
    # On peut désactiver le chargement de Gemma si on veut optimiser,
    # mais ici on utilise la classe telle quelle en s'assurant que NLLB local est prêt.
    print("⏳ Initialisation du modèle NLLB local...")
    start_time = time.time()
    try:
        interpreter = LanguageInterpreter()
        
        # Forcer le chargement du modèle NLLB
        if interpreter.translation_model is None:
            interpreter._init_translation_local()
        
        if interpreter.translation_model is None:
            print("❌ ERREUR : Le modèle NLLB local n'est pas chargé.")
            print(f"   Vérifiez que le dossier existe : {interpreter.translation_local_path}")
            print("   Vérifiez votre .env (TRANSLATION_LOCAL_PATH)")
            return

        print(f"✅ Modèle prêt en {time.time() - start_time:.2f}s")
        print(f"📝 Texte source : \"{args.text}\"")
        print("-" * 60)

        # 2. Traduction
        langs_to_test = ["moore", "dioula"] if args.lang == "all" else [args.lang]

        for lang in langs_to_test:
            print(f"🔄 Traduction vers le {lang.upper()}...")
            start_t = time.time()
            
            # Appel DIRECT à la méthode locale (ignore Gradio/Online)
            result = interpreter._translate_local(args.text, lang)
            
            duration = time.time() - start_t
            if result:
                print(f"✨ Résultat ({duration:.2f}s) :")
                print(f"   {result}")
            else:
                print(f"⚠️  Échec de la traduction vers {lang}")
            print()

    except Exception as e:
        print(f"❌ Erreur critique : {e}")

    print("="*60 + "\n")

if __name__ == "__main__":
    run_translation()

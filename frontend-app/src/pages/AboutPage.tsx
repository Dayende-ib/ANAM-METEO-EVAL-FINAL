import { Accordion } from "../components/Accordion";
import { Layout } from "../components/Layout";

const pipelineSteps = [
 {
 icon: "database",
 title: "Collecte de données",
 description:
  "Collecte des données météorologiques nationales et internationales pour constituer un jeu robuste et représentatif.",
 },
 {
 icon: "cleaning_services",
 title: "Nettoyage et prétraitement",
 description: "Nettoyage des valeurs manquantes, harmonisation des unités et préparation aux étapes suivantes.",
 },
 {
 icon: "engineering",
 title: "Ingénierie des caractéristiques",
 description: "Extraction et création d’attributs pertinents pour améliorer la performance des modèles.",
 },
 {
 icon: "model_training",
 title: "Entraînement et évaluation des modèles",
 description: "Entraînement continu des modèles et suivi des métriques clés pour garantir la fiabilité.",
 },
 {
 icon: "monitoring",
 title: "Visualisation et reporting",
 description: "Restitution claire des prévisions et indicateurs via un tableau de bord interactif.",
 },
];

const team = [
 {
 name: "Diallo Djeneba",
 role: "Project Lead & Data Scientist",
 bio: "Experte en modèles de machine learning et analytique prédictive.",
 image:
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDHRup4ABET3LtxsAcFQH0mAYJ72Hx9nS3wwSwwXKHdKtoojjHCyxZEFu79b_wSumKKGGD9cMokI3GOuaRqR2UDVr4ItIEYcxJI3UzXl1tc6-Oz5JGBK5QsQA3Oz0lpyzIqkque-wOpxVT1wNMOZip4U7Ls6twCqfo6XyHW3PdrVYimLxQceGqniQa2Y2F0EzfVbI4kDL-PaPjVhDp59kXqVT6nIXzKTOcnJNVBNZxdaVb74DKrGcRIocND_OyaV2nSjy9cCNT0CQ",
 },
 {
 name: "Ougda Ibrahim",
 role: "Backend & Cloud Engineer",
 bio: "Responsable du pipeline de données et du déploiement dans le cloud.",
 image:
  "https://lh3.googleusercontent.com/aida-public/AB6AXuARBxV8pfsPQXVjvHWtJN5DSgdMxx-zpnTw3WVZkxhlC11bFajafA_ET5vXp_Xc-2Sx_I9Oy7LxxsdSzDNOZhQbxs6NSJzFAuiEaW6MjvJEdlSy9AFcrcgRbZLTbvzFYl6lyRPXWjX66QKLIG0xxuSxZOqR6R58TuZqHnggXZ9NM7BP80zKAD8LOcmoq25Tpbk_zHRru62P-MNfkOkBq0ijSWB6pL6AJ1KGSCGh6uoY_WLW2WavWH_dI0OkSjuQndZ8-23M0RVLnw",
 },
 {
 name: "Silga Patricia",
 role: "UI/UX Designer & Frontend",
 bio: "Conçoit les expériences utilisateur et les visualisations interactives.",
 image:
  "https://lh3.googleusercontent.com/aida-public/AB6AXuC_LjoOhrZPxEFIJ-sz9JMCV6jwekQqGR71ZBREkNzzL-b5yLm_EsM9UZnVm9m5pMSknidOOiyrcOspualdfZEm0L_vio6PD587o1SKrZua7F2WtACatIpgwo3mgt8C3s3BgOd5FF4PTz9IIOJinkeZ7a3Bdstr8QymLNb6wtikV-k9WfAMRTlzbqlN_N3__-TTBvMB-2lCNYW1QQPWtvPU51zMySg1IGf0RKxgRZkWOLvk4aBaZlTLBR3ux8wzo74K69xs9lug1Q",
 },
];

export function AboutPage() {
 return (
 <Layout title="A propos">
  <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 md:py-20">
  <header className="text-center mb-16">
   <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-ink ">
À propos du projet ANAM-MÉTÉO-EVAL
   </h1>
   <p className="mt-4 max-w-3xl mx-auto text-lg text-muted">
Visualisation des données météorologiques et évaluation des performances de prédiction pour le Hackathon
   MTDPCE 2025.
   </p>
  </header>
  <section className="space-y-16">
   <article>
   <h2 className="text-2xl font-bold leading-tight tracking-tight text-primary border-b border-[var(--border)] pb-3 mb-6">
Vue d'ensemble du projet
   </h2>
   <p className="text-base leading-relaxed text-muted">
    Notre objectif est de proposer un système robuste pour visualiser les données météorologiques et évaluer
    avec précision les performances des modèles prédictifs dédiés au Burkina Faso.
   </p>
   </article>
   <article>
   <h2 className="text-2xl font-bold leading-tight tracking-tight text-primary border-b border-[var(--border)] pb-3 mb-8">
Le pipeline de données
   </h2>
   <Accordion items={pipelineSteps} />
   </article>
   <article>
   <h2 className="text-2xl font-bold leading-tight tracking-tight text-primary border-b border-[var(--border)] pb-3 mb-6">
Hackathon MTDPCE 2025
   </h2>
   <p className="text-base leading-relaxed text-muted">
    L’initiative MTDPCE mobilise les talents pour résoudre les défis nationaux, notamment en météorologie,
    afin d’accélérer la transition numérique du Burkina Faso.
   </p>
   </article>
   <article>
   <h2 className="text-2xl font-bold leading-tight tracking-tight text-primary border-b border-[var(--border)] pb-3 mb-8">
Rencontrez l'équipe
   </h2>
   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
    {team.map((member) => (
    <div key={member.name} className="text-center">
     <img
     src={member.image}
     alt={member.name}
     className="w-32 h-32 rounded-full mx-auto object-cover mb-4 ring-4 ring-secondary/50"
     />
     <h3 className="text-xl font-bold text-ink ">{member.name}</h3>
     <p className="text-secondary font-medium">{member.role}</p>
     <p className="mt-2 text-sm text-muted">{member.bio}</p>
    </div>
    ))}
   </div>
   </article>
  </section>
  </div>
 </Layout>
 );
}


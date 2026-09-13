import { SiteShell } from "../components/site-shell";
import { HomeCta, HomeEcosystem, HomeHero, HomeHowItWorks, HomePartners, HomeProof, HomeStory } from "../components/home-sections";

export default function Home() {
  return <SiteShell><HomeHero /><HomePartners /><HomeHowItWorks /><HomeStory /><HomeProof /><HomeEcosystem /><HomeCta /></SiteShell>;
}

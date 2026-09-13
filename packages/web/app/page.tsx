import { AuthoredPage } from "../components/authored-page";
import { EcosystemCards } from "../components/ecosystem-cards";

export default function Home() {
  return (
    <>
      <AuthoredPage name="landing" />
      <EcosystemCards />
    </>
  );
}

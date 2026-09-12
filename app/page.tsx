import {
  AboutSection,
  FaqSection,
  HeroSection,
  HowItWorksSection,
  ProcessSection,
  ServicesSection,
  SiteFooter,
  SiteHeader,
  TrustBadgesSection,
  UspSection,
} from "@/components/landing";
import { getSessionUser } from "@/lib/auth/session";
import {
  aboutContent,
  faqItems,
  footerLinks,
  heroContent,
  highlightContent,
  howItWorksSteps,
  metrics,
  navItems,
  p2pSteps,
  processSteps,
  reasons,
  trustBadges,
} from "@/lib/content/landing-content";

export default async function Home() {
  const isAuthenticated = Boolean(await getSessionUser());

  return (
    <div className="site-shell">
      <SiteHeader items={navItems} isAuthenticated={isAuthenticated} />

      <main>
        <HeroSection content={heroContent} isAuthenticated={isAuthenticated} />
        <ServicesSection metrics={metrics} content={highlightContent} />
        <HowItWorksSection steps={howItWorksSteps} />
        <ProcessSection steps={processSteps} />
        <UspSection items={reasons} />
        <AboutSection content={aboutContent} steps={p2pSteps} />
        <TrustBadgesSection badges={trustBadges} />
        <FaqSection items={faqItems} />
      </main>

      <SiteFooter links={footerLinks} />
    </div>
  );
}

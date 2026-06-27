import React from "react";
import WebsiteLayout from "./layouts/WebsiteLayout";
import HeroSection from "./sections/HeroSection";
import FeaturesSection from "./sections/FeaturesSection";
import PricingSection from "./sections/PricingSection";
import SetupGuideSection from "./sections/SetupGuideSection";
import FAQSection from "./sections/FAQSection";
import FooterSection from "./sections/FooterSection";

export default function WebsiteShell() {
  return (
    <WebsiteLayout>
      <HeroSection />
      <FeaturesSection />
      <PricingSection />
      <SetupGuideSection />
      <FAQSection />
      <FooterSection />
    </WebsiteLayout>
  );
}

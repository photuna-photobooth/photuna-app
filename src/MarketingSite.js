import React from "react";

export default function MarketingSite() {
  const websiteSrc = window.location.protocol === "file:"
    ? "./website/index.html"
    : "/website/index.html";

  return (
    <iframe
      title="Studio Photuna website"
      src={websiteSrc}
      style={{
        width: "100%",
        minHeight: "100vh",
        border: 0,
        display: "block",
        background: "#ffffff",
      }}
    />
  );
}

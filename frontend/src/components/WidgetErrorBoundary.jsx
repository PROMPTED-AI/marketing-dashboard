// Vangt een render-fout van één widget op, zodat een enkele kapotte widget niet
// het hele dashboard blank maakt (React unmount't anders de complete boom bij een
// niet-opgevangen render-fout). Toont een nette fallback in plaats daarvan.
import { Component } from "react";
import { SectionCard } from "./ui.jsx";

export default class WidgetErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prevProps) {
    // Reset bij een nieuwe widget/periode, zodat een herstelde widget weer rendert.
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <SectionCard title={this.props.title} style={{ height: "100%" }}>
          <div style={{ padding: "24px 0", display: "grid", placeItems: "center", color: "var(--c-muted)", fontSize: 13, textAlign: "center" }}>
            deze widget kon niet worden geladen
          </div>
        </SectionCard>
      );
    }
    return this.props.children;
  }
}

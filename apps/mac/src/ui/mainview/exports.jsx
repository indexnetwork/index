function BottomBar({ stats }) {
  return (
    <div style={{
      border:"1px solid #000", background:"#fff",
      display:"grid", gridTemplateColumns:"1fr auto",
      alignItems:"center",
      padding:"0 14px", gap:14,
      fontFamily:"var(--mac-mono)", fontSize:10,
      color:"#000", height:"100%",
    }}>
      <div style={{ display:"flex", gap:18, alignItems:"center" }}>
        <span style={{ letterSpacing:1.5 }}>FIELD</span>
        <span><b>{stats.online}</b> agents online</span>
        <span>·</span>
        <span>inspected <b>{stats.inspected}</b></span>
        <span>·</span>
        <span>passed <b>{stats.passed}</b></span>
      </div>
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <LiveDot size={6}/>
        <span>syn-0518-bk-04</span>
      </div>
    </div>
  );
}

window.MainView = MainView;
window.DeepLinkWindow = DeepLinkWindow;

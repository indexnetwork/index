export default function LoadingSection() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexDirection: "column",
        height: "100%",
        textAlign: "center",
        margin: "auto",
      }}
    >
      <div>
        <video
          autoPlay
          loop
          muted
          playsInline
          className={"p-0"}
          style={{
            width: "30%",
            margin: "auto",
          }}
        >
          <source src="/video/loadingPerspective.mp4" type="video/mp4" />
        </video>
        <p>Loading...</p>
      </div>
    </div>
  );
}

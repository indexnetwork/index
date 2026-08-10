// Settings, reached from the account chip on the hub. Three panes: what the
// network sees (profile), how the agent interrupts you (notifications), and
// the keys other agents authenticate with.

// Soft length guide for the introduction counter. The API stores intro with no
// hard cap, and enrichment synthesizes a full narrative paragraph, so this is
// generous enough that a real enriched profile doesn't render as "over".
const INTRO_MAX = 2000;

/* ---------- shared field chrome ---------- */

function FieldLabel({ children, required, right }) {
  return (
    <div style={{
      display:"flex", alignItems:"baseline", justifyContent:"space-between",
      gap:10, marginBottom:5,
    }}>
      <span style={{
        fontFamily:"var(--mac-mono)", fontSize:11, fontWeight:600, color:"#000",
      }}>
        {children}
        {required && <span style={{ color:"#FF8A00", marginLeft:4 }}>*</span>}
      </span>
      {right}
    </div>
  );
}

// Sunken well, the inverse of a raised gadget, so inputs read as editable.
const wellStyle = (disabled) => ({
  border:"1px solid #000",
  background: disabled ? "#EDEAE1" : "#fff",
  boxShadow:"inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #FFF",
  padding:"7px 10px",
  display:"flex", alignItems:"center", gap:0,
});

const inputReset = (disabled) => ({
  flex:1, minWidth:0, background:"transparent", border:"none", outline:"none",
  fontFamily:"var(--mac-sans)", fontSize:13,
  color: disabled ? "var(--ink-2)" : "#000",
});

function TextField({ label, required, value, onChange, disabled, placeholder, right }) {
  return (
    <div style={{ minWidth:0 }}>
      <FieldLabel required={required} right={right}>{label}</FieldLabel>
      <div style={wellStyle(disabled)}>
        <input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => onChange && onChange(e.target.value)}
          style={inputReset(disabled)}
        />
      </div>
    </div>
  );
}

// Prefix sits in its own raised cell so the editable part is unambiguous.
// The left cell is the platform's mark, and the field holds the username on its
// own. The url prefix it replaced was both blank for API-sourced rows (which
// carry no prefix) and redundant next to the logo: an X mark followed by
// "x.com/seren" says the platform twice. The full address is rebuilt on save.
// A row can be removed outright, which is the only way to take a link off a
// profile.
function SocialField({ social, value, onChange, onRemove }) {
  const [hot, setHot] = useState(false);
  const platform = socialPlatformOf(social);
  const isWeb = platform === "website";
  return (
    <div style={{ display:"flex", border:"1px solid #000", background:"#fff" }}>
      <span
        title={platform}
        style={{
          background:"#EDEAE1", padding:"0 9px",
          borderRight:"1px solid #000",
          display:"flex", alignItems:"center", flex:"0 0 auto",
        }}>
        <SocialGlyph id={platform} size={15}/>
      </span>
      <input
        value={value}
        placeholder={isWeb ? "your-site.com" : "username"}
        onChange={e => onChange && onChange(socialHandleOf({ ...social, handle: e.target.value }))}
        style={{ ...inputReset(false), padding:"8px 10px" }}
      />
      {onRemove && (
        <button
          onClick={onRemove}
          onMouseEnter={() => setHot(true)}
          onMouseLeave={() => setHot(false)}
          title={`remove ${platform}`}
          aria-label={`remove ${platform}`}
          style={{
            flex:"0 0 auto", width:30, cursor:"pointer",
            borderLeft:"1px solid #000",
            background: hot ? "var(--ink-warn)" : "#EDEAE1",
            color: hot ? "#fff" : "var(--ink-2)",
            fontFamily:"var(--mac-mono)", fontSize:13, lineHeight:1,
          }}>×</button>
      )}
    </div>
  );
}

function SectionRule({ children, size }) {
  return <div style={{ marginTop:26 }}><RuleLabel size={size}>{children}</RuleLabel></div>;
}

/* ---------- pane 1 · profile ---------- */

// The picture is the control, see PicturePicker in primitives for the shared
// icon, interaction and file rules.
function PhotoPicker({ me, name, photo, onPick }) {
  const [err, setErr] = useState("");

  return (
    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
      <PicturePicker size={54} label="change photo" onPick={onPick} onError={setErr}>
        {photo
          ? <img
              src={photo}
              alt=""
              style={{
                width:54, height:54, objectFit:"cover", display:"block",
              }}/>
          : <Avatar id={me.id} name={me.name} size={54}/>}
      </PicturePicker>

      <div style={{ minWidth:0 }}>
        <div style={{
          fontFamily:"var(--mac-mono)", fontSize:17, fontWeight:700, color:"#000",
        }}>{name || me.name}</div>

        {err && (
          <div style={{
            marginTop:4,
            fontFamily:"var(--mac-sans)", fontSize:11, color:"var(--ink-warn)",
          }}>{err}</div>
        )}
      </div>
    </div>
  );
}

function ProfilePane({ me, form, set, profileOnly = false }) {
  const over = form.intro.length > INTRO_MAX;

  return (
    <div>
      <PhotoPicker
        me={me}
        name={form.name}
        photo={form.photo}
        onPick={url => set("photo", url)}
      />

      <div style={{
        marginTop:22,
        display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"14px 18px",
      }}>
        <TextField
          label="name" required
          value={form.name}
          onChange={v => set("name", v)}
        />
        {/* Identity is bound to the email the agent authenticated with. The
            greyed well and non-editable cursor already say it isn't editable,
            so the field carries no extra badge. */}
        <TextField
          label="email" disabled
          value={form.email}
        />
        {/* One column like name/email, a full-width field for "NYC, United
            States" was far more room than the value ever needs. */}
        <TextField
          label="location"
          value={form.location}
          onChange={v => set("location", v)}
        />
      </div>

      <div style={{ marginTop:14 }}>
        <FieldLabel right={
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:11,
            color: over ? "var(--ink-warn)" : "var(--ink-2)",
            fontWeight: over ? 700 : 400,
          }}>{form.intro.length}/{INTRO_MAX}</span>
        }>introduction</FieldLabel>
        <div style={{ ...wellStyle(false), alignItems:"stretch", padding:"8px 10px" }}>
          <textarea
            value={form.intro}
            onChange={e => set("intro", e.target.value)}
            rows={4}
            style={{ ...inputReset(false), resize:"vertical", lineHeight:1.5 }}
          />
        </div>
      </div>

      <SectionRule>socials</SectionRule>

      <div style={{
        marginTop:12,
        display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"9px 14px",
      }}>
        {form.socials.map((s, i) => (
          <SocialField
            key={s.id || s.label || i}
            social={s}
            value={socialHandleOf(s)}
            onChange={v => set("socials", form.socials.map(
              (x, j) => j === i ? { ...x, handle: v } : x
            ))}
            onRemove={() => set("socials", form.socials.filter((_, j) => j !== i))}
          />
        ))}

        {form.websites.map((w, i) => (
          <SocialField
            key={`w${i}`}
            social={{ id:"website", prefix:"https://" }}
            value={w}
            onChange={v => set("websites", form.websites.map((x, j) => j === i ? v : x))}
            onRemove={() => set("websites", form.websites.filter((_, j) => j !== i))}
          />
        ))}

        {/* dashed = not yet a field, just an invitation to add one. Sized to
            its label rather than to the grid: a full-width dashed box was far
            bigger than the action warranted, but a full cell would read as an
            empty social slot. Hugging the text makes it unmistakably a button. */}
        <button
          onClick={() => set("websites", [...form.websites, ""])}
          style={{
            justifySelf:"start",
            padding:"9px 14px", cursor:"pointer",
            border:"1px dashed #000", background:"transparent",
            fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
          }}>+ add website</button>
      </div>

      {/* the danger zone belongs to settings, not first-run setup */}
      {!profileOnly && (
        <React.Fragment>
          <DangerZone/>
        </React.Fragment>
      )}
    </div>
  );
}

/* ---------- danger zone ---------- */

// Collapsed by default, destructive actions shouldn't sit in the tab order of
// a form you opened to fix a typo.
function DangerZone() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop:26 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display:"flex", alignItems:"center", gap:7, padding:0,
          border:"none", background:"transparent", cursor:"pointer",
          fontFamily:"var(--mac-mono)", fontSize:11, fontWeight:700,
          letterSpacing:0.6, color:"var(--ink-warn)", textTransform:"uppercase",
        }}>
        <span style={{
          display:"inline-block",
          transform: open ? "rotate(90deg)" : "none",
        }}>›</span>
        danger zone
      </button>

      {open && (
        <div className="fade-up" style={{
          marginTop:10, padding:"11px 12px",
          border:"1px solid var(--ink-warn)", background:"#FFF3F3",
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
        }}>
          <div style={{ minWidth:0 }}>
            <div style={{
              fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:600, color:"var(--ink-warn)",
            }}>delete account</div>
            <div style={{
              marginTop:3, fontFamily:"var(--mac-sans)", fontSize:12,
              lineHeight:1.45, color:"var(--ink-2)",
            }}>
              index stops immediately and every signal closes. connections
              you've already made stay with the other person.
            </div>
          </div>
          <button style={{
            flex:"0 0 auto",
            fontFamily:"var(--mac-mono)", fontSize:12, padding:"6px 15px",
            border:"1px solid var(--ink-warn)", background:"var(--ink-warn)", color:"#fff",
            boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
          }}>delete</button>
        </div>
      )}
    </div>
  );
}

/* ---------- pane 2 · notifications ---------- */

// Workbench checkbox, a raised square that fills when checked.
function Toggle({ on, onClick, title, blurb }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        display:"flex", gap:11, alignItems:"flex-start", textAlign:"left",
        width:"100%", padding:"10px 12px", cursor:"pointer",
        border:"1px solid #000", background:"#fff",
        boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
      }}>
      <span style={{
        flex:"0 0 auto", width:16, height:16, marginTop:1,
        border:"1px solid #000",
        background: on ? "#FF8A00" : "#EDEAE1",
        boxShadow: on
          ? "inset 1px 1px 0 #8A4500, inset -1px -1px 0 #FFD7A0"
          : "inset 1px 1px 0 #FFF, inset -1px -1px 0 var(--ink-3)",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontFamily:"var(--mac-mono)", fontSize:11, fontWeight:700, color:"#000",
      }}>{on ? "✓" : ""}</span>
      <span style={{ minWidth:0 }}>
        <span style={{
          display:"block", fontFamily:"var(--mac-mono)", fontSize:12,
          fontWeight:600, color:"#000",
        }}>{title}</span>
        <span style={{
          display:"block", marginTop:3, fontFamily:"var(--mac-sans)",
          fontSize:12, lineHeight:1.45, color:"var(--ink-2)",
        }}>{blurb}</span>
      </span>
    </button>
  );
}

const NOTIFY_OPTIONS = [
  { id:"alignment", title:"an alignment surfaces",
    blurb:"index found someone worth meeting and wants to hand them over." },
  { id:"question",  title:"a question comes up",
    blurb:"someone on the other side needs an answer only you can give." },
  { id:"accepted",  title:"an intro is accepted",
    blurb:"someone said yes. the chat opens on both sides." },
  { id:"digest",    title:"daily digest",
    blurb:"one quiet summary each morning instead of live pings." },
];

function NotificationsPane({ notify, toggle }) {
  return (
    <div>
      <p style={{
        margin:"0 0 14px", maxWidth:520,
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
      }}>
        index works in the background. choose what's worth interrupting you for.
      </p>
      <div style={{ display:"grid", gap:9 }}>
        {NOTIFY_OPTIONS.map(o => (
          <Toggle
            key={o.id}
            on={!!notify[o.id]}
            onClick={() => toggle(o.id)}
            title={o.title}
            blurb={o.blurb}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- pane 3 · api keys ---------- */

const KEYS = [
  { id:"k1", label:"personal access", key:"idx_live_8f3c…a91e", used:"2 hours ago" },
  { id:"k2", label:"raycast script",  key:"idx_live_2b77…40dd", used:"6 days ago" },
];

function maskKey(key) {
  if (!key) return "";
  return key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
}

// Live pane: the mac authenticates with a single CLI API key held in the
// Keychain. It can't be listed/rotated from here (those routes are
// session-only), so we surface the injected key masked and offer revoke, which
// deletes the Keychain credential and signs out via the native bridge.
function LiveApiKeyPane() {
  const native = (window.IndexApp && window.IndexApp.native && window.IndexApp.native()) || {};
  const masked = maskKey(native.apiKey);
  const revoke = () => { if (window.IndexApp) window.IndexApp.logout(); };
  return (
    <div>
      <p style={{
        margin:"0 0 14px", maxWidth:520,
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
      }}>
        this mac is signed in with a single access key stored in your keychain.
        revoking it signs you out here and stops it working immediately.
      </p>
      <div style={{
        border:"1px solid #000", background:"#fff", boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
        padding:"10px 12px",
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
      }}>
        <div style={{ minWidth:0 }}>
          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:600, color:"#000",
          }}>this mac</div>
          <div style={{
            marginTop:3, fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
          }}>{masked || "no key"}</div>
        </div>
        <button
          onClick={revoke}
          style={{
            flex:"0 0 auto",
            fontFamily:"var(--mac-mono)", fontSize:12, padding:"6px 14px",
            border:"1px solid #000", background:"#fff", color:"var(--ink-warn)",
            boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
          }}>revoke & sign out</button>
      </div>
    </div>
  );
}

function ApiKeysPane() {
  return (
    <div>
      <p style={{
        margin:"0 0 14px", maxWidth:520,
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
      }}>
        keys let other tools act as you on the network. revoke one and it stops
        working immediately.
      </p>

      <div style={{ display:"grid", gap:9 }}>
        {KEYS.map(k => (
          <div key={k.id} style={{
            border:"1px solid #000", background:"#fff", boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
            padding:"10px 12px",
            display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
          }}>
            <div style={{ minWidth:0 }}>
              <div style={{
                fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:600, color:"#000",
              }}>{k.label}</div>
              <div style={{
                marginTop:3, fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
              }}>{k.key} · used {k.used}</div>
            </div>
            <button style={{
              flex:"0 0 auto",
              fontFamily:"var(--mac-mono)", fontSize:12, padding:"6px 14px",
              border:"1px solid #000", background:"#fff", color:"var(--ink-warn)",
              boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
            }}>revoke</button>
          </div>
        ))}
      </div>

      <button style={{
        marginTop:12,
        fontFamily:"var(--mac-mono)", fontSize:11, padding:"6px 14px",
        border:"1px solid #000", background:"#FF8A00", color:"#000", fontWeight:700,
        boxShadow:"2px 2px 0 rgba(0,0,0,0.22)", cursor:"pointer",
      }}>+ new key</button>
    </div>
  );
}

/* ---------- shell ---------- */

// onClose , leave without committing. In settings that closes the pane; at
//            first run there's nothing behind this screen, so the caller sends
//            it back to sign-in. The titlebar gadget uses this too.
// onDone  , the single committing path. Defaults to onClose so the ordinary
//            settings pane behaves exactly as before.
// A public-research enrichment result is "usable" for the review when it filled
// in a bio or discovered at least one social — otherwise we fall through to the
// context/preview drafts below.
function usableEnriched(res) {
  const p = res && res.profile;
  return !!(p && (String(p.intro || "").trim() || (p.socials && p.socials.length)));
}

function Settings({ onClose, onDone, initialTab = "profile", profileOnly = false, enrich = false, enriched = null }) {
  const env = (typeof useIndexEnv === "function") ? useIndexEnv() : { live: false };
  // The signed-in user, mirrored onto INDEX_DATA.ME once the snapshot loads.
  // Live-only: empty when nothing has loaded yet, never a demo identity.
  const ME = env.me || window.INDEX_DATA.ME || {};
  const live = !!(env.live && window.IndexApp && window.IndexApp.isAuthed());
  const client = live && window.IndexApp ? window.IndexApp.getClient() : null;
  const [tab, setTab] = useState(initialTab);
  // What the agent assembled, the baseline "reset" restores to.
  // Socials are normalized on the way in so the fields hold a bare username:
  // the API returns {label, value} with value as a whole URL.
  const assembled = useRef({
    name: ME.name || "", email: ME.email || "", location: ME.location || "",
    intro: ME.intro || "",
    socials: (ME.socials || []).map(normalizeSocial),
    websites: ME.websites || [],
    photo: ME.photo || null,
  });
  const [form, setForm] = useState(assembled.current);
  const [notify, setNotify] = useState(ME.notify || {
    alignment: true, question: true, accepted: true, digest: false,
  });

  // Enrichment-backed getting-started. Primary path: trigger the public-research
  // enrichment synchronously (POST /enrichment/enrich). It looks the
  // person up from name+email and returns the resolved identity + discovered
  // socials, so the review shows real, filled-in fields (including socials).
  // Fallbacks, in order: an already-enriched context (read_user_contexts), then a
  // fresh preview_user_context draft for a brand-new user with nothing yet.
  // The chosen draft is retained so confirm_user_context saves the approved one.
  const draftRef = useRef(null);
  // No loader when enrichment already ran on the "setting up" screen and filled
  // the review — the form is shown once, pre-populated, with no second spinner.
  const [drafting, setDrafting] = useState(enrich && live && !usableEnriched(enriched));
  useEffect(() => {
    if (!enrich || !live || !window.IndexApp || !window.IndexApp.invokeTool) { setDrafting(false); return; }
    let cancelled = false;
    const adopt = (next) => {
      assembled.current = { ...assembled.current, ...next };
      setForm(f => ({ ...f, ...next }));
    };
    (async () => {
      // Public research already ran in parallel on the "setting up" screen; adopt
      // its result here (no second call) and only fall through to the context/
      // preview drafts when it came back empty.
      try {
        const res = enriched;
        const p = res && res.profile;
        if (p && (String(p.intro || "").trim() || (p.socials && p.socials.length))) {
          const list = p.socials || [];
          const isSite = (s) => /^(custom|website)$/i.test(String(s.label || ""));
          const known = list.filter((s) => !isSite(s)).map(normalizeSocial);
          const sites = list
            .filter(isSite)
            .map((s) => String(s.value || "").replace(/^https?:\/\//i, "").replace(/\/+$/, ""))
            .filter(Boolean);
          const intro = p.intro || "";
          const location = p.location || "";
          draftRef.current = {
            identity: { name: p.name || "", bio: intro, location },
            narrative: { context: intro },
            attributes: { skills: [], interests: [] },
          };
          adopt({
            name: assembled.current.name || p.name || "",
            location: assembled.current.location || location,
            intro: assembled.current.intro || intro,
            socials: known.length ? known : assembled.current.socials,
            websites: sites.length ? sites : assembled.current.websites,
          });
          if (!cancelled) setDrafting(false);
          return;
        }
      } catch (e) { /* fall through to reading any prior enriched context */ }

      try {
        const ctx = await window.IndexApp.invokeTool("read_user_contexts", {});
        if (cancelled) return;
        const c = ctx && ctx.success !== false && ctx.data;
        if (c && c.hasProfile && String(c.context || "").trim()) {
          const context = c.context;
          // Enrichment persists only the narrative, so location/skills live in
          // prose. Run that narrative back through preview_user_context (which
          // infers a structured identity from text) to recover a location and
          // interest tags, without discarding the rich narrative itself.
          let location = c.location || "";
          let skills = [], interests = [];
          try {
            const pv = await window.IndexApp.invokeTool("preview_user_context", { bioOrDescription: context });
            const pd = pv && pv.success !== false && pv.data && pv.data.draft;
            if (pd) {
              const pid = pd.identity || {}, pat = pd.attributes || {};
              const loc = String(pid.location || "").trim();
              if (!location && loc && !/^(unknown|undisclosed|remote|n\/a)$/i.test(loc)) location = loc;
              skills = pat.skills || []; interests = pat.interests || [];
            }
          } catch (e) { /* keep the narrative; just leave location/tags unfilled */ }
          if (cancelled) return;
          draftRef.current = {
            identity: { name: c.name || "", bio: c.bio || context, location },
            narrative: { context },
            attributes: { skills, interests },
          };
          adopt({
            name: assembled.current.name || c.name || "",
            location: assembled.current.location || location,
            // The enriched narrative is the profile index built — show it here
            // (the intro is what /auth/me reads; enrichment left it empty).
            intro: assembled.current.intro || c.bio || context || "",
          });
          if (!cancelled) setDrafting(false);
          return;
        }
      } catch (e) { /* no enriched context yet — fall through to a fresh preview */ }

      const q = {};
      for (const s of (ME.socials || [])) {
        const v = String(s.value || s.handle || "").trim();
        if (!v) continue;
        const lbl = String(s.label || s.id || "").toLowerCase();
        if (lbl.includes("linkedin")) q.linkedinUrl = v;
        else if (lbl.includes("github")) q.githubUrl = v;
        else if (lbl.includes("twitter") || lbl === "x") q.twitterUrl = v;
      }
      if (ME.intro) q.bioOrDescription = ME.intro;
      try {
        const res = await window.IndexApp.invokeTool("preview_user_context", q);
        if (cancelled) return;
        if (res && res.success !== false && res.data && res.data.draft) {
          const d = res.data.draft;
          draftRef.current = d;
          const id = d.identity || {};
          adopt({
            name: assembled.current.name || id.name || "",
            location: assembled.current.location || id.location || "",
            intro: assembled.current.intro || id.bio || "",
          });
        }
      } catch (e) { /* fall back to the plain /auth/me values already in the form */ }
      finally { if (!cancelled) setDrafting(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggle = (id) => setNotify(n => ({ ...n, [id]: !n[id] }));

  // Edited relative to what was assembled, drives whether reset is offered.
  const dirty = JSON.stringify(form) !== JSON.stringify(assembled.current);
  const reset = () => setForm(assembled.current);

  // Write back onto the shared record so the rest of the app (the account row,
  // any pane reopened later) sees the edit, then get out of the way. This is
  // the ONLY path that commits, and at first run the only one that counts as
  // finishing onboarding.
  const save = async () => {
    let photo = form.photo || null;
    let avatarKey = null;
    if (live && client && photo && /^data:/i.test(photo)) {
      // PicturePicker only yields a data URL; upload it so the face survives a
      // relaunch (file:// localStorage does not).
      try {
        avatarKey = await client.storage.uploadAvatar(photo);
        photo = window.IndexApp.avatarUrl(avatarKey);
      } catch (e) { /* keep the local preview; profile text still saves */ }
    }
    Object.assign(ME, {
      name: form.name,
      location: form.location,
      intro: form.intro,
      socials: form.socials,
      websites: form.websites,
      photo,
      notify,
    });
    if (live && client) {
      // The fields hold a bare username, so the full address is rebuilt here.
      // Extra websites go up as 'custom', the one label the schema's per-user
      // uniqueness index deliberately exempts, so more than one can be stored.
      const socials = (form.socials || [])
        .filter((s) => s && String(s.handle || "").trim())
        .map((s) => ({ label: s.id || "link", value: socialHrefOf(s) }));
      const sites = (form.websites || [])
        .filter((w) => String(w || "").trim())
        .map((w) => ({ label: "custom", value: socialHrefOf({ id: "website", handle: w }) }));
      // First-run enrichment gate: persist the approved profile through
      // confirm_user_context, which durably records onboarding.profileConfirmedAt
      // (so this screen doesn't reappear) and decomposes premises. The
      // updateProfile call below persists socials and, via setSocials, enqueues
      // the full enrich.user pipeline (Parallel lookup -> premises -> discovery).
      if (enrich && window.IndexApp && window.IndexApp.invokeTool) {
        const d = draftRef.current || {};
        const approved = {
          identity: { name: form.name.trim(), bio: form.intro.trim(), location: form.location.trim() },
          narrative: { context: (d.narrative && d.narrative.context) || "" },
          attributes: {
            skills: (d.attributes && d.attributes.skills) || [],
            interests: (d.attributes && d.attributes.interests) || [],
          },
        };
        await window.IndexApp.invokeTool("confirm_user_context", { draft: approved }).catch(() => {});
      }
      await client.auth.updateProfile({
        name: form.name,
        intro: form.intro,
        location: form.location,
        socials: [...socials, ...sites],
        ...(avatarKey ? { avatar: avatarKey } : {}),
      }).catch(() => {});
    }
    (onDone || onClose)();
  };

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      {/* Tabbed settings uses a fixed height so switching panes doesn't jump the
          frame. First-run has no tabs, so it hugs its content and shows the
          whole profile without scrolling (capped to the viewport). */}
      <div style={{
        width:860, maxWidth:"100%",
        height: profileOnly ? undefined : "min(660px, calc(100vh - 112px))",
        maxHeight: "calc(100vh - 112px)",
      }}>
        <MacWindow
          title={profileOnly ? "getting started" : "index · settings"}
          onClose={onClose}
          style={{ height: profileOnly ? undefined : "100%", maxHeight:"100%", minHeight:0 }}>

          {/* first-run shows only the profile, no notifications / api keys.
              The titlebar already reads "index · getting started", so repeating
              "getting started" as a heading here was the same words twice; the
              band carries the instruction instead, the one thing the titlebar
              can't say. */}
          {profileOnly ? (
            <div style={{ padding:"14px 24px", borderBottom:"2px solid #000" }}>
              <div style={{
                fontFamily:"var(--mac-sans)", fontSize:13, color:"#000",
              }}>{drafting
                ? "pulling together your profile…"
                : "here's what i pulled together. make sure it's right."}</div>
            </div>
          ) : (
            <div style={{
              padding:"18px 24px 0",
              borderBottom:"2px solid #000",
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
            }}>
              <div style={{ paddingBottom:14 }}>
                <MacSegmented
                  size="lg"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value:"profile",  label:"profile" },
                    { value:"notify",   label:"notifications" },
                    { value:"keys",     label:"api keys" },
                  ]}
                />
              </div>
            </div>
          )}

          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto",
            padding:"20px 24px 22px",
          }}>
            {tab === "profile" && <ProfilePane me={ME} form={form} set={set} profileOnly={profileOnly}/>}
            {tab === "notify"  && <NotificationsPane notify={notify} toggle={toggle}/>}
            {tab === "keys"    && (live ? <LiveApiKeyPane/> : <ApiKeysPane/>)}
          </div>

          <div style={{
            borderTop:"2px solid #000", padding:"11px 24px",
            display:"flex", alignItems:"center", justifyContent:"flex-end", gap:10,
          }}>
            {/* Three separate intents, three controls, "cancel" used to mean
                both "undo my edits" and "get me out of here", which is why it
                read as ambiguous next to a confirm button.

                reset     restores the assembled values, stays on the screen
                sign out  leaves without committing (first run only, there is
                          no app behind this screen to fall back to)
                confirm   the only committing action */}
            {profileOnly && dirty && (
              <button
                onClick={reset}
                style={{
                  fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 17px",
                  border:"1px solid #000", background:"#fff", color:"var(--ink-2)",
                  boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
                  marginRight:"auto",
                }}>reset</button>
            )}
            <button
              onClick={onClose}
              style={profileOnly ? {
                fontFamily:"var(--mac-mono)", fontSize:12, padding:"7px 10px",
                border:"none", background:"transparent", color:"var(--ink-2)",
                textDecoration:"underline", cursor:"pointer", opacity:0.7,
              } : {
                fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 17px",
                border:"1px solid #000", background:"#fff", color:"#000",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
              }}>{profileOnly ? "sign out" : "cancel"}</button>
            <button
              onClick={save}
              style={{
                fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 19px",
                border:"1px solid #000", background:"#000", color:"#fff",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer", fontWeight:700,
              }}>{profileOnly ? "looks good →" : "save changes"}</button>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

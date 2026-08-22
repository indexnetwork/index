function Networks({ onClose, onOpenSignal }) {
  // Live-only: the mirror holds the signed-in user's networks (set by
  // applyLoaded). Ensure it is an array so the local unshift below still
  // persists a just-created network to the other screens.
  const NETWORKS = (window.INDEX_DATA.NETWORKS = window.INDEX_DATA.NETWORKS || []);
  // Live backend wiring: writes fire against services/api when signed in, but
  // the UI keeps updating the local mirror exactly as the offline demo does.
  const live = !!(window.IndexApp && window.IndexApp.isAuthed());
  const client = live ? window.IndexApp.getClient() : null;
  const [tab, setTab] = useState("mine");
  const [openNet, setOpenNet] = useState(null);
  // Which tab the detail window opens on. Null is the usual overview; creation
  // sets "access" so a brand-new network hands you its link straight away.
  const [openTab, setOpenTab] = useState(null);
  const [creating, setCreating] = useState(false);
  // One-shot line the detail window shows on arrival, set by create.
  const [openNote, setOpenNote] = useState("");
  // Early-access request flow: non-staff submit a reviewed request instead of
  // creating a live network. `canReview` (from the server) gates direct create.
  const [requesting, setRequesting] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [canReview, setCanReview] = useState(false);
  // Local mirror of the shared list so a new network renders immediately;
  // NETWORKS itself is still mutated so other screens see it too.
  const [nets, setNets] = useState(NETWORKS);
  const [discoverNets, setDiscoverNets] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState(null);
  const [joiningId, setJoiningId] = useState(null);

  const loadRequests = () => {
    if (!client) return;
    client.networkRequests.listMine()
      .then((r) => {
        setMyRequests((r && r.requests) || []);
        setCanReview(!!(r && r.canReview));
      })
      .catch(() => {});
  };

  // One-shot on mount: `client` is rebuilt each render, so depending on it would
  // loop; a single load (refreshed explicitly after mutations) is enough.
  useEffect(() => { loadRequests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Boot snapshot no longer embeds networks; fetch on open so the list is not
  // stuck on the empty array seeded at first paint.
  useEffect(() => {
    if (!live || !window.IndexApp) return;
    const load = window.IndexApp.loadNetworks
      ? () => window.IndexApp.loadNetworks()
      : () => {
          const c = window.IndexApp.getClient && window.IndexApp.getClient();
          if (!c) return Promise.resolve(null);
          return c.networks.list().then((res) => {
            const raw = window.IndexApp.normalizeList(res, "networks");
            return {
              networks: window.IndexApp.mapDiscoverNetworks
                ? raw.map((n) => window.IndexApp.mapDiscoverNetworks([{ ...n, isMember: true }])[0])
                : raw,
            };
          });
        };
    load()
      .then((net) => {
        if (!net || !Array.isArray(net.networks)) return;
        window.INDEX_DATA.NETWORKS = net.networks;
        setNets([...net.networks]);
      })
      .catch(() => {});
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPublicNetworks = () => {
    if (!client) {
      setDiscoverNets([]);
      return;
    }
    setDiscoverLoading(true);
    setDiscoverError(null);
    client.networks.discoverPublic(1, 50)
      .then((res) => {
        const raw = window.IndexApp.normalizeList(res, "networks");
        const mapped = window.IndexApp.mapDiscoverNetworks(raw);
        setDiscoverNets(mapped);
      })
      .catch(() => {
        setDiscoverNets([]);
        setDiscoverError("Failed to load public networks. Please try again later.");
      })
      .finally(() => { setDiscoverLoading(false); });
  };

  const handleTabChange = (next) => {
    setTab(next);
    if (next === "discover") loadPublicNetworks();
  };

  // You made it, so you're in it and you run it. Picture is optional: a data
  // URL from the picker is uploaded first so imageUrl on the server is a real
  // storage key, not a discarded local preview. After create (or when a reviewed
  // request is approved and the network lands in the list), owners open Access
  // to copy the invitation / network link — same as the web Access tab.
  const createNetwork = async ({ name, desc, access, photo }) => {
    let imageUrl = null;
    let photoOut = photo || undefined;
    if (client && photo && /^data:/i.test(photo)) {
      try {
        imageUrl = await client.storage.uploadIndexImage(photo);
        photoOut = window.IndexApp.avatarUrl(imageUrl) || imageUrl;
      } catch (e) { /* keep the local data URL in the mirror */ }
    }
    const joinPolicy = access === "public" ? "anyone" : "invite_only";
    let created = {
      id: `net-${Date.now().toString(36)}`,
      name,
      blurb: desc || undefined,
      photo: photoOut,
      members: 1,
      privacy: access,
      joinPolicy,
      invitationCode: null,
      role: "owner",
      joined: true,
      hasMasterKey: false,
      signals: [],
    };
    if (client) {
      try {
        const res = await client.networks.create({
          title: name,
          prompt: desc || undefined,
          imageUrl: imageUrl || undefined,
          joinPolicy,
        });
        const n = (res && res.network) || res || {};
        const perms = n.permissions || {};
        const jp = perms.joinPolicy || joinPolicy;
        const code = perms.invitationLink && perms.invitationLink.code;
        created = {
          ...created,
          id: n.id || created.id,
          name: n.title || created.name,
          members: (n._count && n._count.members) || n.memberCount || 1,
          joinPolicy: jp,
          privacy: jp === "anyone" ? "public" : "private",
          invitationCode: code || null,
          hasMasterKey: n.hasMasterKey === true,
          photo: window.IndexApp.avatarUrl(n.imageUrl) || created.photo,
          source: n,
        };
      } catch (e) {
        // Signed in, so the server is the authority on whether this network
        // exists. Swallowing the failure here would leave a network in the
        // list that is gone on the next load, and the confirmation screen
        // would announce it as created. The form shows the error instead.
        throw e;
      }
    }
    NETWORKS.unshift(created);
    setNets([...NETWORKS]);
    setCreating(false);
    setTab("mine");
    setOpenTab("access");
    setOpenNote(`${created.name} is live. send the link to let people in.`);
    setOpenNet(created);
  };

  const updateOpenNet = (merged) => {
    setNets(prev => prev.map(n => n.id === merged.id ? { ...n, ...merged } : n));
    const i = NETWORKS.findIndex(n => n.id === merged.id);
    if (i >= 0) NETWORKS[i] = { ...NETWORKS[i], ...merged };
  };

  // Submit (or resubmit) a network request; resolves the request so the form
  // can show its confirmation panel. Same upload path as create: a picked
  // picture becomes a storage key before the request is written.
  const submitRequest = async (input) => {
    if (!client) return null;
    let imageUrl = input.imageUrl;
    if (input.photo && /^data:/i.test(input.photo)) {
      try {
        imageUrl = await client.storage.uploadIndexImage(input.photo);
      } catch (e) { /* request still goes through without a picture */ }
    }
    const body = {
      name: input.name,
      purpose: input.purpose,
      expectedSize: input.expectedSize,
      joinPolicy: input.joinPolicy,
      ...(imageUrl !== undefined ? { imageUrl } : {}),
    };
    const p = editingRequest
      ? client.networkRequests.update(editingRequest.id, body)
      : client.networkRequests.create(body);
    return p.then((res) => {
      loadRequests();
      return (res && res.request) || res;
    });
  };

  const dismissRequest = (id) => {
    setMyRequests(prev => prev.filter(r => r.id !== id));
    if (client) client.networkRequests.dismiss(id).catch(() => {});
  };

  const startCreate = () => {
    // Staff create networks directly; everyone else submits a reviewed request.
    if (canReview) {
      setCreating(true);
    } else {
      setEditingRequest(null);
      setRequesting(true);
    }
  };

  const joinNetwork = (net) => {
    if (!net || !net.id) return;
    setJoiningId(net.id);
    setDiscoverError(null);
    const joined = { ...net, joined: true, role: "member" };
    setDiscoverNets(prev => prev.filter(n => n.id !== net.id));
    NETWORKS.unshift(joined);
    setNets([...NETWORKS]);
    if (!client) {
      setJoiningId(null);
      return;
    }
    client.networks.join(net.id)
      .then(() => { loadPublicNetworks(); })
      .catch(() => {
        setDiscoverError("Failed to join that network.");
        const i = NETWORKS.findIndex(n => n.id === net.id);
        if (i >= 0) NETWORKS.splice(i, 1);
        setNets([...NETWORKS]);
        setDiscoverNets(prev => [net, ...prev]);
      })
      .finally(() => { setJoiningId(null); });
  };

  const leaveNetwork = (net) => {
    setNets(prev => prev.filter(n => n.id !== net.id));
    const i = NETWORKS.findIndex(n => n.id === net.id);
    if (i >= 0) NETWORKS.splice(i, 1);
    if (client) client.networks.leave(net.id).catch(() => {});
    setOpenNet(null);
  };

  const deleteNetwork = (net) => {
    setNets(prev => prev.filter(n => n.id !== net.id));
    const i = NETWORKS.findIndex(n => n.id === net.id);
    if (i >= 0) NETWORKS.splice(i, 1);
    setOpenNet(null);
  };

  if (openNet) {
    return (
      <NetworkDetail
        net={openNet}
        initialTab={openTab}
        flash={openNote}
        onBack={() => { setOpenNet(null); setOpenTab(null); setOpenNote(""); }}
        onLeave={leaveNetwork}
        onUpdated={updateOpenNet}
        onDeleted={deleteNetwork}
        onOpenSignal={onOpenSignal}
      />
    );
  }
  // Its own window, like the profile screen, not an overlay on this one.
  if (creating) {
    return <CreateNetwork onCancel={() => setCreating(false)} onCreate={createNetwork}/>;
  }
  if (requesting) {
    return (
      <RequestNetwork
        initial={editingRequest}
        onCancel={() => { setRequesting(false); setEditingRequest(null); }}
        onSubmit={submitRequest}
      />
    );
  }

  const mine = nets.filter(n => n.joined);
  const shown = tab === "mine" ? mine : discoverNets;

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      {/* fixed height so switching tabs doesn't resize the frame */}
      <div style={{
        width:860, maxWidth:"100%",
        height:"min(660px, calc(100vh - 112px))",
      }}>
        <MacWindow
          title="networks"
          onClose={onClose}
          style={{ height:"100%", minHeight:0 }}>

          <div style={{
            padding:"18px 24px 0", borderBottom:"2px solid #000",
          }}>
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
            }}>
              <h2 style={{
                margin:0,
                fontFamily:"var(--mac-mono)", fontSize:19, fontWeight:700, color:"#000",
              }}>networks</h2>
              <ActionButton
                title={canReview ? "start a new network" : "request a new network"}
                onClick={startCreate}>+ create</ActionButton>
            </div>

            <div style={{ padding:"14px 0" }}>
              <MacSegmented
                size="lg"
                value={tab}
                onChange={handleTabChange}
                options={[
                  { value:"mine",     label:`my networks (${mine.length})` },
                  { value:"discover", label:"discover" },
                ]}
              />
            </div>
          </div>

          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto",
            padding:"6px 12px 14px",
          }}>
            {tab === "mine" && myRequests.map(req => (
              <RequestStatusRow
                key={req.id}
                req={req}
                onEdit={(r) => { setEditingRequest(r); setRequesting(true); }}
                onDismiss={dismissRequest}
              />
            ))}

            {shown.map(net => (
              <NetworkRow
                key={net.id}
                net={net}
                onOpen={(n) => { setOpenTab(null); setOpenNote(""); setOpenNet(n); }}
                onJoin={joinNetwork}
                joining={joiningId === net.id}/>
            ))}

            {tab === "discover" && discoverLoading && (
              <p style={{
                margin:"18px 12px",
                fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)",
              }}>loading public networks…</p>
            )}

            {tab === "discover" && !discoverLoading && discoverError && (
              <p style={{
                margin:"18px 12px",
                fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--mac-red, #c00)",
              }}>{discoverError}</p>
            )}

            {!shown.length && !(tab === "mine" && myRequests.length) && !(tab === "discover" && discoverLoading) && !(tab === "discover" && discoverError) && (
              <p style={{
                margin:"18px 12px",
                fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)",
              }}>{tab === "discover" ? "No public networks to discover right now." : "nothing here yet."}</p>
            )}
          </div>
        </MacWindow>
      </div>

    </div>
  );
}

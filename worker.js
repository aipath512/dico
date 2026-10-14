// dico — dicționar la nivel de rețea AiVenture S.R.L. (SSOT în KV, sesiune în meta.session)
// v0.2: adaugă /adn.json generat din dico (înlocuiește adn.json static al fiecărui site)
// Rute: <domeniu>/dico.json  |  <domeniu>/dico/network.json  |  <domeniu>/dico/entity/<id>
// Citire doar. Actualizarea se face manual în KV (nicio cheie/token în cod).
const H = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" };
const out = (o, s = 200) => new Response(JSON.stringify(o, null, 1), { status: s, headers: H });
const j = async (kv, k) => JSON.parse((await kv.get(k)) || "null");

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const host = u.hostname.replace(/^www\./, "");
    const kv = env.DICO_KV;
    const [meta, sites] = await Promise.all([j(kv, "meta"), j(kv, "sites")]);
    if (!meta || !sites) return out({ error: "KV gol: încărcați kv-seed" }, 503);
    // site-ul cerut: din host; pe domeniul Worker-ului (workers.dev / dico.*) din ?site=
    const site = sites[host] ? host : (u.searchParams.get("site") || "").replace(/^www\./, "");
    const p = u.pathname.replace(/\/+$/, "");
    const head = { dico: meta.dico.shortname, firm: meta.dico.firm, session: meta.session, version: meta.version, status: meta.status };

    if (p === "/adn.json") {
      const ents = await j(kv, "entities");
      const node = (e) => ({ domain: "https://" + e.name, role: e.adn.role, status: e.adn.status, adn: `https://${e.name}/adn.json`, belongs_to_value_ladder: e.adn.module ? { module: e.adn.module } : undefined });
      const root = { network_name: "AiVenture ADI Network", root_domain: "https://5thelement.ai", operator: { name: "AiVenture SRL", legal_id: "CUI 51415878", contact: "contact@5thelement.ai" }, dico: `https://${host}/dico.json`, session: meta.session };
      const withAdn = ents.filter(e => e.type === "Website" && e.adn);
      if (host === "5thelement.ai") return out({ schema: "https://5thelement.ai/schemas/adn.v1.json", version: "1.1", ...root, nodes: withAdn.filter(e => e.name !== "5thelement.ai").map(node) });
      const me = withAdn.find(e => e.name === site);
      if (!me) return out({ schema: "https://5thelement.ai/schemas/adn.v1.json", version: "1.1", domain: "https://" + (site || host), ...root, belongs_to_network: "https://5thelement.ai/adn.json", status: "unclassified: nod fără rol în sursa dico" });
      return out({ schema: "https://5thelement.ai/schemas/adn.v1.json", version: "1.1", domain: "https://" + me.name, node_role: me.adn.role, status: me.adn.status, belongs_to_network: "https://5thelement.ai/adn.json", ...root, belongs_to_value_ladder: me.adn.module ? { module: me.adn.module } : undefined });
    }
    if (p === "/dico/network.json") {
      const [ents, rels] = await Promise.all([j(kv, "entities"), j(kv, "relationships")]);
      const shared = ents.filter(e => (e.appears_on || []).filter(a => a.site).length > 1)
        .map(e => ({ id: e.id, name: e.name, sites: e.appears_on.map(a => a.site) }));
      return out({ ...head, sites: Object.keys(sites).map(s => ({ site: s, entity: sites[s], url: `https://${s}/dico.json` })),
        shared_entities: shared, relation_types: meta.relation_types, counts: meta.counts });
    }
    if (p.startsWith("/dico/entity/")) {
      const id = decodeURIComponent(p.slice(13));
      const [ents, rels] = await Promise.all([j(kv, "entities"), j(kv, "relationships")]);
      const e = ents.find(x => x.id === id);
      if (!e) return out({ error: "entitate necunoscută", id }, 404);
      return out({ ...head, entity: e, relationships: rels.filter(r => r.subject === id || r.object === id),
        also_on: (e.appears_on || []).map(a => ({ site: a.site, url: `https://${a.site}/dico/entity/${id}` })) });
    }
    if (p === "/dico.json" || p === "/dico") {
      if (!site || !sites[site]) return out({ ...head, error: "site necunoscut în rețea", known_sites: Object.keys(sites) }, 404);
      const [ents, rels, kws, ints, pages] = await Promise.all(["entities", "relationships", "keywords", "intents", "pages"].map(k => j(kv, k)));
      const E = ents.filter(e => e.id === sites[site] || e.id === meta.dico.firm || (e.appears_on || []).some(a => a.site === site));
      const ids = new Set(E.map(e => e.id));
      const R = rels.filter(r => (r.observed_on || []).includes(site) || (ids.has(r.subject) && ids.has(r.object)));
      const shared = E.filter(e => (e.appears_on || []).some(a => a.site !== site))
        .map(e => ({ id: e.id, name: e.name, also_on: e.appears_on.filter(a => a.site !== site).map(a => `https://${a.site}/dico/entity/${e.id}`) }));
      return out({ ...head, site, site_entity: sites[site], network: "https://" + host + "/dico/network.json",
        sibling_sites: Object.keys(sites).filter(s => s !== site).map(s => ({ site: s, dico: `https://${s}/dico.json` })),
        shared_with_other_sites: shared, entities: E, relationships: R,
        keywords: kws.filter(k => k.network_counts && k.network_counts[site]),
        intents: ints.filter(i => i.site === site), pages: pages && site === "aiventure.ro" ? pages : [] });
    }
    return out({ ...head, endpoints: ["/adn.json", "/dico.json", "/dico/network.json", "/dico/entity/<id>"] }, 404);
  }
};

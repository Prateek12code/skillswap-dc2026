import "./style.css";
import { supabase, supabaseConfigured } from "./supabase.js";

const app = document.querySelector("#app");

let state = {
  session: null,
  profile: null,
  skills: [],
  people: [],
  requests: [],
  view: "home",
  loading: true,
  authMode: "login",
};

let chatChannel = null;
let chatRequestId = null;
let videoChannel = null;
let peerConnection = null;
let localStream = null;
let pendingIce = [];
let offerMade = false;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name = "User") {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U"
  );
}

function formatDate(value) {
  if (!value) return "Recently";
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function sameSkill(a = "", b = "") {
  const one = a.toLowerCase().trim();
  const two = b.toLowerCase().trim();
  return one === two || one.includes(two) || two.includes(one);
}

function myTeachSkills() {
  return state.skills
    .filter((item) => item.type === "teach")
    .map((item) => item.skill);
}

function myLearnSkills() {
  return state.skills
    .filter((item) => item.type === "learn")
    .map((item) => item.skill);
}

function skillPills(skills = [], className = "") {
  if (!skills.length)
    return '<span class="empty-inline">Nothing added yet</span>';
  return skills
    .map(
      (skill) =>
        `<span class="skill-pill ${className}">${escapeHtml(skill)}</span>`,
    )
    .join("");
}

function getPerson(id) {
  return state.people.find((person) => person.id === id);
}

function otherUserId(request) {
  if (!state.session) return null;
  return request.sender_id === state.session.user.id
    ? request.receiver_id
    : request.sender_id;
}

function otherName(request) {
  if (!state.session) return "Skill partner";
  return request.sender_id === state.session.user.id
    ? request.receiver_name
    : request.sender_name;
}

function nav() {
  const loggedIn = Boolean(state.session);
  if (loggedIn) {
    return `
      <header class="nav-wrap">
        <nav class="nav shell-nav">
          <button class="brand" data-go="dashboard">Skill<span>Swap</span></button>
          <div class="nav-links">
            <button class="${state.view === "dashboard" ? "active" : ""}" data-go="dashboard">Dashboard</button>
            <button class="${state.view === "discover" ? "active" : ""}" data-go="discover">Discover</button>
          </div>
          <div class="profile-menu-wrap">
            <button class="profile-menu-button" id="profileMenuButton">
              <span class="tiny-avatar">${escapeHtml(initials(state.profile?.name))}</span>
              <span>${escapeHtml(state.profile?.name || "Profile")}</span>
              <span class="chevron">⌄</span>
            </button>
            <div class="profile-dropdown" id="profileDropdown">
              <button data-go="profile">Edit profile</button>
              <button id="logoutBtn">Log out</button>
            </div>
          </div>
        </nav>
      </header>
    `;
  }

  return `
    <header class="nav-wrap">
      <nav class="nav shell-nav">
        <button class="brand" data-go="home">Skill<span>Swap</span></button>
        <div class="nav-links">
          <button data-scroll="how">How it works</button>
        </div>
        <div class="nav-actions">
          <button class="ghost" data-auth="login">Log in</button>
          <button class="dark" data-auth="signup">Get started</button>
        </div>
      </nav>
    </header>
  `;
}

function homeView() {
  return `
    ${nav()}
    <main>
      <section class="hero shell">
        <div class="eyebrow"><span></span> Learn from people, not another playlist</div>
        <h1>Know something.<br><em>Learn anything.</em></h1>
        <p class="hero-copy">Exchange what you already know for a skill you actually want. SkillSwap finds people who can teach you, helps you connect and keeps the learning in one place.</p>
        <div class="swap-builder">
          <div class="builder-row">
            <div>
              <label>I can teach</label>
              <input id="heroTeach" placeholder="e.g. JavaScript" autocomplete="off" />
            </div>
            <div class="swap-mark">⇄</div>
            <div>
              <label>I want to learn</label>
              <input id="heroLearn" placeholder="e.g. Photography" autocomplete="off" />
            </div>
          </div>
          <button class="match-cta" id="heroMatchBtn">Find my matches <span>→</span></button>
        </div>
        <div class="hero-note">A direct skill swap costs nothing. You teach something useful, and learn something useful back.</div>
      </section>

      <section class="shell how" id="how">
        <div class="how-head"><span class="kicker light">HOW IT WORKS</span><h2>One useful exchange from start to finish.</h2></div>
        <div class="steps">
          <article><b>01</b><div class="step-icon">+</div><h3>Add your skills</h3><p>Tell SkillSwap what you can teach and what you want to learn.</p></article>
          <article><b>02</b><div class="step-icon">⇄</div><h3>Find the overlap</h3><p>Recommendations only show people who can teach something on your learning list.</p></article>
          <article><b>03</b><div class="step-icon">↗</div><h3>Learn together</h3><p>Accept a swap, message your partner, start a video session and mark it complete.</p></article>
        </div>
      </section>

      <section class="shell final-cta">
        <p>Everyone already knows something worth sharing.</p>
        <h2>Turn your skill into your next skill.</h2>
        <button class="light-btn" data-auth="signup">Create your profile →</button>
      </section>
    </main>
    ${footer()}
  `;
}

function recommendationFor(person) {
  const teach = myTeachSkills();
  const learn = myLearnSkills();
  const wantedMatches = learn.filter((wanted) =>
    person.teaches.some((skill) => sameSkill(wanted, skill)),
  );
  if (!wantedMatches.length) return null;
  const reverseMatches = teach.filter((mine) =>
    person.learns.some((skill) => sameSkill(mine, skill)),
  );
  let score = 70;
  score += Math.min(15, (wantedMatches.length - 1) * 5);
  if (reverseMatches.length) score += 12;
  score += Math.min(3, Math.max(0, reverseMatches.length - 1) * 2);
  score = Math.min(100, score);
  return {
    person,
    score,
    want: wantedMatches[0],
    offer: reverseMatches[0] || teach[0] || "",
    twoWay: reverseMatches.length > 0,
    wantedMatches,
    reverseMatches,
  };
}

function getRecommendations() {
  if (!state.session) return [];
  return state.people
    .filter((person) => person.id !== state.session.user.id)
    .map(recommendationFor)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function personCard(person, recommendation = null) {
  return `
    <article class="person-card" data-profile-id="${person.id}" tabindex="0">
      <div class="person-card-head">
        <div class="avatar">${escapeHtml(initials(person.name))}</div>
        <div class="person-title"><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(person.location || "Online")}</p></div>
        ${recommendation ? `<span class="score">${recommendation.score}%</span>` : ""}
      </div>
      <p class="card-bio">${escapeHtml(person.bio || "Ready to share a skill and learn something new.")}</p>
      <div class="card-skill-row">
        <span>Teaches</span>
        <div>${skillPills(person.teaches.slice(0, 3))}</div>
      </div>
      ${
        recommendation
          ? `
        <div class="match-reason">
          <strong>${escapeHtml(recommendation.want)}</strong>
          <span>${recommendation.twoWay ? `You can teach ${escapeHtml(recommendation.offer)} back` : "Matches something you want to learn"}</span>
        </div>
        <button class="card-action" data-request="${person.id}" data-offer="${escapeHtml(recommendation.offer)}" data-want="${escapeHtml(recommendation.want)}">Request swap <span>→</span></button>
      `
          : '<button class="card-secondary">View profile →</button>'
      }
    </article>
  `;
}

function activeSwapCard(request, featured = false) {
  const person = getPerson(otherUserId(request));
  const name = otherName(request);
  const activity = formatDate(
    request.last_interaction_at || request.created_at,
  );
  return `
    <article class="active-swap ${featured ? "featured" : ""}">
      <div class="active-main">
        <div class="avatar ${featured ? "large" : ""}">${escapeHtml(initials(name))}</div>
        <div>
          <span class="active-label">${featured ? "CONTINUE YOUR SESSION" : "ACTIVE SWAP"}</span>
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(request.offered_skill)} <span>⇄</span> ${escapeHtml(request.wanted_skill)}</p>
          ${person?.bio && featured ? `<small>${escapeHtml(person.bio)}</small>` : ""}
        </div>
      </div>
      <div class="activity-time">Active ${activity}</div>
      <div class="active-actions">
        <button class="soft-action" data-chat="${request.id}">Message</button>
        <button class="dark-action" data-call="${request.id}">Video call</button>
        <button class="complete-action" data-complete="${request.id}">Mark complete</button>
      </div>
    </article>
  `;
}

function requestItem(request) {
  const incoming = request.receiver_id === state.session.user.id;
  const name = incoming ? request.sender_name : request.receiver_name;
  return `
    <article class="request-item">
      <div class="mini-avatar">${escapeHtml(initials(name))}</div>
      <div class="request-copy">
        <strong>${escapeHtml(name)}</strong>
        <p>${escapeHtml(request.offered_skill)} <span>⇄</span> ${escapeHtml(request.wanted_skill)}</p>
        <small>${incoming ? "Wants to swap with you" : "Waiting for a response"}</small>
      </div>
      ${
        incoming
          ? `<div class="request-actions"><button class="accept" data-request-status="${request.id}" data-status="accepted">Accept</button><button data-request-status="${request.id}" data-status="declined">Decline</button></div>`
          : '<span class="pending-chip">Pending</span>'
      }
    </article>
  `;
}

function dashboardView() {
  const recommendations = getRecommendations();
  const active = state.requests
    .filter((request) => request.status === "accepted")
    .sort(
      (a, b) =>
        new Date(b.last_interaction_at || b.created_at) -
        new Date(a.last_interaction_at || a.created_at),
    );
  const pending = state.requests.filter(
    (request) => request.status === "pending",
  );
  const completed = state.requests.filter(
    (request) => request.status === "completed",
  );
  const mainSwap = active[0];
  const otherActive = active.slice(1, 4);

  return `
    ${nav()}
    <main class="page shell dashboard-page">
      <section class="dashboard-intro">
        <div><span class="kicker">DASHBOARD</span><h1>Hey, ${escapeHtml(state.profile?.name || "there")}.</h1><p>${active.length ? "Pick up where you left off, or find someone new to learn with." : "Add your skills, find a match and start your first exchange."}</p></div>
        <button class="outline" data-go="profile">Edit my skills</button>
      </section>

      ${
        mainSwap
          ? `
        <section class="continue-section">
          ${activeSwapCard(mainSwap, true)}
        </section>
      `
          : `
        <section class="getting-started">
          <div><span class="kicker">START HERE</span><h2>Your first useful match is one profile away.</h2><p>SkillSwap recommends people based on the skills you said you want to learn.</p></div>
          <button class="dark" data-go="discover">Find people →</button>
        </section>
      `
      }

      <section class="dashboard-layout">
        <div class="dashboard-main">
          ${
            otherActive.length
              ? `
            <div class="section-heading-small"><div><span class="kicker">YOUR PEOPLE</span><h2>Keep learning</h2></div></div>
            <div class="active-list">${otherActive.map((request) => activeSwapCard(request)).join("")}</div>
          `
              : ""
          }

          <div class="section-heading-small"><div><span class="kicker">RECOMMENDED FOR YOU</span><h2>People who teach what you want</h2></div><button class="text-link" data-go="discover">See all →</button></div>
          ${
            myLearnSkills().length
              ? recommendations.length
                ? `<div class="people-grid compact">${recommendations
                    .slice(0, 3)
                    .map((item) => personCard(item.person, item))
                    .join("")}</div>`
                : `<div class="empty-state"><h3>No matching teachers yet</h3><p>Your recommendations only show people who teach something from your learning list. Try adding another skill or search Discover.</p><button class="outline" data-go="discover">Open Discover</button></div>`
              : `<div class="empty-state"><h3>Add what you want to learn</h3><p>Recommendations appear after you add at least one learning skill.</p><button class="outline" data-go="profile">Add a skill</button></div>`
          }
        </div>

        <aside class="dashboard-side">
          <section class="side-panel">
            <div class="side-title"><span class="kicker">REQUESTS</span><span class="count-badge">${pending.length}</span></div>
            ${pending.length ? pending.slice(0, 5).map(requestItem).join("") : '<div class="side-empty">No pending requests.</div>'}
          </section>
          <section class="side-panel tiny-stats">
            <div><span>Teaching</span><strong>${myTeachSkills().length}</strong></div>
            <div><span>Learning</span><strong>${myLearnSkills().length}</strong></div>
            <div><span>Completed</span><strong>${completed.length}</strong></div>
          </section>
          ${
            completed.length
              ? `<section class="side-panel"><div class="side-title"><span class="kicker">COMPLETED</span></div>${completed
                  .slice(0, 4)
                  .map(
                    (request) =>
                      `<div class="completed-row"><span>${escapeHtml(otherName(request))}</span><small>${escapeHtml(request.wanted_skill)}</small></div>`,
                  )
                  .join("")}</section>`
              : ""
          }
        </aside>
      </section>
    </main>
    ${footer()}
  `;
}

function discoverView() {
  const recommendations = getRecommendations();
  return `
    ${nav()}
    <main class="page shell discover-page">
      <div class="page-head discover-head">
        <div><span class="kicker">DISCOVER</span><h1>Find the right person.</h1><p>Recommendations are based on what you want to learn. Search lets you look through the wider community.</p></div>
        <div class="search-box"><input id="discoverSearch" placeholder="Search a person or skill" autocomplete="off" /><span>⌕</span></div>
      </div>
      <div class="recommendation-note">
        <span class="spark">✦</span>
        <div><strong>Recommended for your learning list</strong><p>${myLearnSkills().length ? escapeHtml(myLearnSkills().join(", ")) : "Add a learning skill in your profile to get recommendations."}</p></div>
      </div>
      <div id="discoverResults">
        ${renderDiscoverResults(recommendations.map((item) => ({ person: item.person, recommendation: item })))}
      </div>
    </main>
    ${footer()}
  `;
}

function renderDiscoverResults(items) {
  if (!items.length) {
    return `<div class="empty-state discover-empty"><h3>No recommendations yet</h3><p>We could not find anyone who teaches a skill on your learning list. Search above to browse by name or skill.</p></div>`;
  }
  return `<div class="results-label"><span>${items.length} ${items.length === 1 ? "person" : "people"}</span><small>Click a card to view the full profile</small></div><div class="people-grid">${items.map((item) => personCard(item.person, item.recommendation)).join("")}</div>`;
}

function profileView() {
  const teach = myTeachSkills();
  const learn = myLearnSkills();
  return `
    ${nav()}
    <main class="page shell profile-page">
      <div class="profile-heading"><div><span class="kicker">YOUR PROFILE</span><h1>Make the match make sense.</h1><p>These details decide who appears in your recommendations.</p></div><button class="outline" data-go="dashboard">Back to dashboard</button></div>
      <div class="profile-grid">
        <form class="profile-card" id="profileForm">
          <div class="profile-preview"><div class="avatar profile-avatar">${escapeHtml(initials(state.profile?.name))}</div><div><strong>${escapeHtml(state.profile?.name || "Your name")}</strong><span>${escapeHtml(state.profile?.location || "Add your location")}</span></div></div>
          <label>Name<input id="profileName" maxlength="60" value="${escapeHtml(state.profile?.name || "")}" required /></label>
          <label>Location<input id="profileLocation" maxlength="80" value="${escapeHtml(state.profile?.location || "")}" placeholder="e.g. Trichy" /></label>
          <label>Bio<textarea id="profileBio" maxlength="300" placeholder="A short line about what you enjoy learning or teaching">${escapeHtml(state.profile?.bio || "")}</textarea></label>
          <div class="save-row"><button class="dark" type="submit">Save profile</button><span id="saveMessage"></span></div>
        </form>

        <div class="skills-editor">
          <section class="skill-editor-card">
            <div><span class="kicker">I CAN TEACH</span><h2>What do you know?</h2></div>
            <div class="add-skill"><input id="teachInput" placeholder="Type a skill" autocomplete="off" /><button data-add-skill="teach">+</button></div>
            <div class="editable-pills">${teach.length ? teach.map((skill) => `<span class="editable-pill">${escapeHtml(skill)}<button data-remove-skill="teach" data-skill="${escapeHtml(skill)}">×</button></span>`).join("") : '<span class="empty-inline">Add at least one skill.</span>'}</div>
          </section>
          <section class="skill-editor-card">
            <div><span class="kicker">I WANT TO LEARN</span><h2>What is next?</h2></div>
            <div class="add-skill"><input id="learnInput" placeholder="Type a skill" autocomplete="off" /><button data-add-skill="learn">+</button></div>
            <div class="editable-pills">${learn.length ? learn.map((skill) => `<span class="editable-pill learn">${escapeHtml(skill)}<button data-remove-skill="learn" data-skill="${escapeHtml(skill)}">×</button></span>`).join("") : '<span class="empty-inline">Add at least one skill.</span>'}</div>
          </section>
        </div>
      </div>
    </main>
    ${footer()}
  `;
}

function footer() {
  return `<footer class="footer shell"><button class="brand" data-go="${state.session ? "dashboard" : "home"}">Skill<span>Swap</span></button><span>Skills are better when shared.</span><span>© 2026</span></footer>`;
}

function authModal(mode = "login") {
  const signup = mode === "signup";
  return `
    <div class="modal-backdrop" id="authModal">
      <div class="auth-modal">
        <button class="modal-close" id="modalClose">×</button>
        <span class="kicker">${signup ? "CREATE ACCOUNT" : "WELCOME BACK"}</span>
        <h2>${signup ? "Start swapping skills." : "Continue learning."}</h2>
        <p>${signup ? "Create a profile, add your skills and get useful recommendations." : "Log in to continue your swaps and conversations."}</p>
        <form id="authForm">
          ${signup ? '<label>Name<input id="authName" maxlength="60" required placeholder="Your name" /></label>' : ""}
          <label>Email<input id="authEmail" type="email" required placeholder="you@example.com" /></label>
          <label>Password<input id="authPassword" type="password" minlength="6" required placeholder="At least 6 characters" /></label>
          <div id="authError" class="form-message"></div>
          <button class="auth-submit" type="submit">${signup ? "Create account →" : "Log in →"}</button>
        </form>
        <div class="auth-switch">${signup ? "Already have an account?" : "New to SkillSwap?"} <button data-auth="${signup ? "login" : "signup"}">${signup ? "Log in" : "Create account"}</button></div>
      </div>
    </div>
  `;
}

function verificationView(email) {
  return `
    <div class="verify-state">
      <div class="verify-icon">✉</div>
      <span class="kicker">VERIFY YOUR EMAIL</span>
      <h2>One quick step.</h2>
      <p>We sent a verification link to <strong>${escapeHtml(email)}</strong>. Open it and you will be brought back to SkillSwap already signed in.</p>
      <small>You can leave this window open while you verify.</small>
      <button class="outline" id="verifyClose">Got it</button>
    </div>
  `;
}

function profileModal(person) {
  const recommendation = recommendationFor(person);
  return `
    <div class="modal-backdrop" id="profileModal">
      <div class="profile-modal">
        <button class="modal-close" id="profileModalClose">×</button>
        <div class="profile-modal-top"><div class="avatar modal-avatar">${escapeHtml(initials(person.name))}</div><div><h2>${escapeHtml(person.name)}</h2><p>${escapeHtml(person.location || "Online")}</p></div>${recommendation ? `<span class="score big-score">${recommendation.score}% match</span>` : ""}</div>
        <p class="profile-modal-bio">${escapeHtml(person.bio || "This person has not added a bio yet.")}</p>
        <div class="modal-skill-block"><span>CAN TEACH</span><div>${skillPills(person.teaches)}</div></div>
        <div class="modal-skill-block"><span>WANTS TO LEARN</span><div>${skillPills(person.learns, "learn")}</div></div>
        ${recommendation ? `<div class="modal-match-box"><strong>You could learn ${escapeHtml(recommendation.want)}</strong><span>${recommendation.twoWay ? `${escapeHtml(person.name)} wants to learn ${escapeHtml(recommendation.offer)} from you.` : "This matches one of the skills on your learning list."}</span></div><button class="card-action large-action" data-request="${person.id}" data-offer="${escapeHtml(recommendation.offer)}" data-want="${escapeHtml(recommendation.want)}">Request this swap <span>→</span></button>` : '<div class="modal-match-box muted-box"><strong>No current skill match</strong><span>You can still find this profile through search, but they do not currently teach something on your learning list.</span></div>'}
      </div>
    </div>
  `;
}

function chatModal(request) {
  const name = otherName(request);
  return `
    <div class="modal-backdrop" id="chatModal">
      <div class="chat-modal">
        <div class="chat-head">
          <div class="person-card-head"><div class="avatar">${escapeHtml(initials(name))}</div><div class="person-title"><h3>${escapeHtml(name)}</h3><p>${escapeHtml(request.offered_skill)} ⇄ ${escapeHtml(request.wanted_skill)}</p></div></div>
          <div class="chat-head-actions"><button class="video-button" data-call="${request.id}">Start video</button><button class="chat-close" id="chatClose">×</button></div>
        </div>
        <div class="chat-messages" id="chatMessages"><div class="chat-loading">Loading messages…</div></div>
        <form class="chat-form" id="chatForm"><input id="chatInput" maxlength="1000" autocomplete="off" placeholder="Write a message" /><button type="submit">Send</button></form>
      </div>
    </div>
  `;
}

function videoModal(request) {
  const name = otherName(request);
  return `
    <div class="video-backdrop" id="videoModal">
      <div class="video-shell">
        <div class="video-topbar">
          <div><span class="video-live-dot"></span><strong>SkillSwap call</strong><small>${escapeHtml(name)} · ${escapeHtml(request.wanted_skill)}</small></div>
          <button id="videoClose">×</button>
        </div>
        <div class="video-stage">
          <video id="remoteVideo" autoplay playsinline></video>
          <div class="waiting-card" id="waitingCard"><div class="avatar huge">${escapeHtml(initials(name))}</div><h2>Waiting for ${escapeHtml(name)}</h2><p>Ask them to open the same accepted swap and press Video call.</p></div>
          <div class="local-video-wrap"><video id="localVideo" autoplay muted playsinline></video><span>You</span></div>
        </div>
        <div class="video-status" id="videoStatus">Starting camera…</div>
        <div class="video-controls">
          <button id="toggleMic">Mic on</button>
          <button id="toggleCam">Camera on</button>
          <button class="hangup" id="hangupBtn">End call</button>
        </div>
      </div>
    </div>
  `;
}

function setupRequiredView() {
  return `
    <main class="setup-page">
      <div class="setup-card">
        <div class="brand setup-brand">Skill<span>Swap</span></div>
        <span class="kicker">BACKEND SETUP REQUIRED</span>
        <h1>Connect Supabase to run SkillSwap.</h1>
        <p>This final version has no offline or demo mode. Add your project URL and anon key to a <code>.env</code> file, then restart Vite.</p>
        <pre>VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY</pre>
      </div>
    </main>
  `;
}

function loadingView() {
  return `<main class="loading-page"><div class="brand">Skill<span>Swap</span></div><div class="loader"></div></main>`;
}

function render() {
  if (!supabaseConfigured) {
    app.innerHTML = setupRequiredView();
    return;
  }
  if (state.loading) {
    app.innerHTML = loadingView();
    return;
  }
  if (state.session && state.view === "home") state.view = "dashboard";
  const views = {
    home: homeView,
    dashboard: dashboardView,
    discover: discoverView,
    profile: profileView,
  };
  app.innerHTML = (
    views[state.view] || (state.session ? dashboardView : homeView)
  )();
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.go;
      if (!state.session && view !== "home") {
        openAuth("login");
        return;
      }
      state.view = view;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document
    .querySelectorAll("[data-scroll]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        document
          .querySelector(`#${button.dataset.scroll}`)
          ?.scrollIntoView({ behavior: "smooth" }),
      ),
    );
  document
    .querySelectorAll("[data-auth]")
    .forEach((button) =>
      button.addEventListener("click", () => openAuth(button.dataset.auth)),
    );
  document.querySelectorAll("[data-profile-id]").forEach((element) =>
    element.addEventListener("click", (event) => {
      if (event.target.closest("[data-request]")) return;
      const person = getPerson(element.dataset.profileId);
      if (person) openProfile(person);
    }),
  );
  document.querySelectorAll("[data-request]").forEach((button) =>
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      sendRequest(button);
    }),
  );
  document
    .querySelectorAll("[data-request-status]")
    .forEach((button) =>
      button.addEventListener("click", () => updateRequestStatus(button)),
    );
  document
    .querySelectorAll("[data-chat]")
    .forEach((button) =>
      button.addEventListener("click", () => openChat(button.dataset.chat)),
    );
  document
    .querySelectorAll("[data-call]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openVideoCall(button.dataset.call),
      ),
    );
  document
    .querySelectorAll("[data-complete]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        completeSwap(button.dataset.complete),
      ),
    );
  document
    .querySelectorAll("[data-add-skill]")
    .forEach((button) =>
      button.addEventListener("click", () => addSkill(button.dataset.addSkill)),
    );
  document
    .querySelectorAll("[data-remove-skill]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        removeSkill(button.dataset.removeSkill, button.dataset.skill),
      ),
    );

  document
    .querySelector("#profileForm")
    ?.addEventListener("submit", saveProfile);
  document
    .querySelector("#discoverSearch")
    ?.addEventListener("input", filterDiscover);
  document
    .querySelector("#heroMatchBtn")
    ?.addEventListener("click", quickStart);
  document
    .querySelector("#heroTeach")
    ?.addEventListener(
      "keydown",
      (event) => event.key === "Enter" && quickStart(),
    );
  document
    .querySelector("#heroLearn")
    ?.addEventListener(
      "keydown",
      (event) => event.key === "Enter" && quickStart(),
    );
  document
    .querySelector("#teachInput")
    ?.addEventListener(
      "keydown",
      (event) => event.key === "Enter" && addSkill("teach"),
    );
  document
    .querySelector("#learnInput")
    ?.addEventListener(
      "keydown",
      (event) => event.key === "Enter" && addSkill("learn"),
    );

  const menuButton = document.querySelector("#profileMenuButton");
  const dropdown = document.querySelector("#profileDropdown");
  menuButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    dropdown?.classList.toggle("open");
  });
  document.addEventListener("click", () => dropdown?.classList.remove("open"), {
    once: true,
  });
  document.querySelector("#logoutBtn")?.addEventListener("click", logout);
}

function quickStart() {
  const teach = document.querySelector("#heroTeach")?.value.trim();
  const learn = document.querySelector("#heroLearn")?.value.trim();
  if (!teach || !learn) {
    toast("Add one skill you can teach and one you want to learn.");
    return;
  }
  sessionStorage.setItem("quickTeach", teach);
  sessionStorage.setItem("quickLearn", learn);
  openAuth("signup");
}

function openAuth(mode) {
  document.querySelector("#authModal")?.remove();
  document.body.insertAdjacentHTML("beforeend", authModal(mode));
  document.querySelector("#modalClose").addEventListener("click", closeAuth);
  document
    .querySelector("#authModal")
    .addEventListener(
      "click",
      (event) => event.target.id === "authModal" && closeAuth(),
    );
  document
    .querySelectorAll("#authModal [data-auth]")
    .forEach((button) =>
      button.addEventListener("click", () => openAuth(button.dataset.auth)),
    );
  document.querySelector("#authForm").addEventListener("submit", handleAuth);
}

function closeAuth() {
  document.querySelector("#authModal")?.remove();
}

async function handleAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const message = document.querySelector("#authError");
  const email = document.querySelector("#authEmail").value.trim();
  const password = document.querySelector("#authPassword").value;
  const name = document.querySelector("#authName")?.value.trim();
  submit.disabled = true;
  submit.textContent = "Working…";
  message.textContent = "";

  try {
    if (name) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name }, emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      if (!data.session) {
        const modal = document.querySelector(".auth-modal");
        modal.innerHTML = verificationView(email);
        document
          .querySelector("#verifyClose")
          .addEventListener("click", closeAuth);
        return;
      }
      closeAuth();
      toast("Account created. Welcome to SkillSwap.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      closeAuth();
    }
  } catch (error) {
    message.textContent = error.message;
    submit.disabled = false;
    submit.textContent = name ? "Create account →" : "Log in →";
  }
}

async function initialize() {
  if (!supabaseConfigured) {
    state.loading = false;
    render();
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  state.session = session;
  if (session) {
    state.view = "dashboard";
    await refreshData();
    await applyQuickSkills();
  }
  state.loading = false;
  render();

  supabase.auth.onAuthStateChange((event, sessionValue) => {
    if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
    setTimeout(async () => {
      state.session = sessionValue;
      if (sessionValue) {
        state.view = "dashboard";
        await refreshData();
        await applyQuickSkills();
      } else {
        state.profile = null;
        state.skills = [];
        state.people = [];
        state.requests = [];
        state.view = "home";
      }
      render();
    }, 0);
  });
}

async function applyQuickSkills() {
  const quickTeach = sessionStorage.getItem("quickTeach");
  const quickLearn = sessionStorage.getItem("quickLearn");
  if (!quickTeach && !quickLearn) return;
  if (quickTeach) await addSkillValue("teach", quickTeach);
  if (quickLearn) await addSkillValue("learn", quickLearn);
  sessionStorage.removeItem("quickTeach");
  sessionStorage.removeItem("quickLearn");
  await refreshData();
}

async function refreshData() {
  if (!state.session) return;
  const userId = state.session.user.id;
  const [
    { data: profile },
    { data: mySkills },
    { data: profiles },
    { data: allSkills },
    { data: requests },
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase
      .from("user_skills")
      .select("*")
      .eq("user_id", userId)
      .order("created_at"),
    supabase
      .from("profiles")
      .select("*")
      .neq("id", userId)
      .order("created_at", { ascending: false }),
    supabase.from("user_skills").select("*"),
    supabase
      .from("swap_requests_view")
      .select("*")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order("last_interaction_at", { ascending: false }),
  ]);

  state.profile = profile;
  state.skills = mySkills || [];
  state.people = (profiles || []).map((person) => ({
    ...person,
    teaches: (allSkills || [])
      .filter((item) => item.user_id === person.id && item.type === "teach")
      .map((item) => item.skill),
    learns: (allSkills || [])
      .filter((item) => item.user_id === person.id && item.type === "learn")
      .map((item) => item.skill),
  }));
  state.requests = requests || [];
}

async function saveProfile(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = document.querySelector("#saveMessage");
  button.disabled = true;
  message.textContent = "Saving…";
  const update = {
    name: document.querySelector("#profileName").value.trim(),
    location: document.querySelector("#profileLocation").value.trim(),
    bio: document.querySelector("#profileBio").value.trim(),
  };
  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", state.session.user.id);
  if (error) {
    message.textContent = error.message;
    button.disabled = false;
    return;
  }
  await refreshData();
  render();
  toast("Profile saved.");
}

async function addSkill(type) {
  const input = document.querySelector(
    type === "teach" ? "#teachInput" : "#learnInput",
  );
  const value = input?.value.trim();
  if (!value) return;
  if (
    state.skills.some(
      (item) => item.type === type && sameSkill(item.skill, value),
    )
  ) {
    input.value = "";
    toast("That skill is already on your profile.");
    return;
  }
  const { error } = await addSkillValue(type, value);
  if (error) {
    toast(error.message);
    return;
  }
  await refreshData();
  render();
}

async function addSkillValue(type, skill) {
  if (!state.session || !skill) return { error: null };
  if (
    state.skills.some(
      (item) => item.type === type && sameSkill(item.skill, skill),
    )
  )
    return { error: null };
  return supabase
    .from("user_skills")
    .insert({ user_id: state.session.user.id, type, skill });
}

async function removeSkill(type, skill) {
  const { error } = await supabase
    .from("user_skills")
    .delete()
    .eq("user_id", state.session.user.id)
    .eq("type", type)
    .eq("skill", skill);
  if (error) {
    toast(error.message);
    return;
  }
  await refreshData();
  render();
}

function filterDiscover() {
  const query =
    document.querySelector("#discoverSearch")?.value.toLowerCase().trim() || "";
  let items;
  if (!query) {
    items = getRecommendations().map((item) => ({
      person: item.person,
      recommendation: item,
    }));
  } else {
    items = state.people
      .filter((person) =>
        [
          person.name,
          person.bio,
          person.location,
          ...person.teaches,
          ...person.learns,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
      .map((person) => ({ person, recommendation: recommendationFor(person) }));
  }
  const results = document.querySelector("#discoverResults");
  if (results) results.innerHTML = renderDiscoverResults(items);
  bindDynamicCards();
}

function bindDynamicCards() {
  document.querySelectorAll("[data-profile-id]").forEach((element) =>
    element.addEventListener("click", (event) => {
      if (event.target.closest("[data-request]")) return;
      const person = getPerson(element.dataset.profileId);
      if (person) openProfile(person);
    }),
  );
  document.querySelectorAll("[data-request]").forEach((button) =>
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      sendRequest(button);
    }),
  );
}

function openProfile(person) {
  document.querySelector("#profileModal")?.remove();
  document.body.insertAdjacentHTML("beforeend", profileModal(person));
  document
    .querySelector("#profileModalClose")
    .addEventListener("click", closeProfileModal);
  document
    .querySelector("#profileModal")
    .addEventListener(
      "click",
      (event) => event.target.id === "profileModal" && closeProfileModal(),
    );
  document
    .querySelector("#profileModal [data-request]")
    ?.addEventListener("click", (event) => {
      event.stopPropagation();
      sendRequest(event.currentTarget);
    });
}

function closeProfileModal() {
  document.querySelector("#profileModal")?.remove();
}

async function sendRequest(button) {
  const receiverId = button.dataset.request;
  const offeredSkill = button.dataset.offer;
  const wantedSkill = button.dataset.want;
  if (!offeredSkill) {
    toast("Add at least one skill you can teach first.");
    return;
  }
  const duplicate = state.requests.some(
    (request) =>
      ["pending", "accepted"].includes(request.status) &&
      ((request.sender_id === state.session.user.id &&
        request.receiver_id === receiverId) ||
        (request.receiver_id === state.session.user.id &&
          request.sender_id === receiverId)),
  );
  if (duplicate) {
    toast("You already have a request or swap with this person.");
    return;
  }
  button.disabled = true;
  button.textContent = "Sending…";
  const { error } = await supabase.from("swap_requests").insert({
    sender_id: state.session.user.id,
    receiver_id: receiverId,
    offered_skill: offeredSkill,
    wanted_skill: wantedSkill,
  });
  if (error) {
    button.disabled = false;
    button.textContent = "Request swap →";
    toast(error.message);
    return;
  }
  await refreshData();
  closeProfileModal();
  render();
  toast("Swap request sent.");
}

async function updateRequestStatus(button) {
  const id = Number(button.dataset.requestStatus);
  const status = button.dataset.status;
  button.disabled = true;
  const { error } = await supabase
    .from("swap_requests")
    .update({ status, last_interaction_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    button.disabled = false;
    toast(error.message);
    return;
  }
  await refreshData();
  render();
  toast(
    status === "accepted"
      ? "Swap accepted. You can now message or call."
      : "Request declined.",
  );
}

async function completeSwap(id) {
  if (
    !confirm(
      "Mark this skill swap as completed? You can still see it in your history.",
    )
  )
    return;
  const { error } = await supabase.rpc("complete_swap", {
    target_swap_id: Number(id),
  });
  if (error) {
    toast(error.message);
    return;
  }
  await refreshData();
  render();
  toast("Session marked complete.");
}

async function touchSwap(id) {
  await supabase.rpc("touch_swap", { target_swap_id: Number(id) });
}

async function openChat(id) {
  const request = state.requests.find((item) => String(item.id) === String(id));
  if (!request || request.status !== "accepted") return;
  closeChat();
  chatRequestId = request.id;
  document.body.insertAdjacentHTML("beforeend", chatModal(request));
  document.querySelector("#chatClose").addEventListener("click", closeChat);
  document
    .querySelector("#chatModal")
    .addEventListener(
      "click",
      (event) => event.target.id === "chatModal" && closeChat(),
    );
  document.querySelector("#chatForm").addEventListener("submit", sendMessage);
  document
    .querySelector("#chatModal [data-call]")
    .addEventListener("click", () => openVideoCall(request.id));
  await loadMessages(request.id);
  await touchSwap(request.id);
  chatChannel = supabase
    .channel(`messages:${request.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `swap_id=eq.${request.id}`,
      },
      () => loadMessages(request.id),
    )
    .subscribe();
}

async function loadMessages(id) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("swap_id", id)
    .order("created_at");
  const box = document.querySelector("#chatMessages");
  if (!box) return;
  if (error) {
    box.innerHTML = `<div class="chat-loading">${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!data?.length) {
    box.innerHTML =
      '<div class="chat-first"><strong>Start the conversation.</strong><span>Agree on what you want to learn first, then jump into a video session when ready.</span></div>';
    return;
  }
  box.innerHTML = data
    .map(
      (message) => `
    <div class="message-row ${message.sender_id === state.session.user.id ? "mine" : ""}">
      <div class="message-bubble"><p>${escapeHtml(message.body)}</p><span>${formatDate(message.created_at)}</span></div>
    </div>
  `,
    )
    .join("");
  box.scrollTop = box.scrollHeight;
}

async function sendMessage(event) {
  event.preventDefault();
  const input = document.querySelector("#chatInput");
  const body = input.value.trim();
  if (!body || !chatRequestId) return;
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  const { error } = await supabase
    .from("messages")
    .insert({ swap_id: chatRequestId, sender_id: state.session.user.id, body });
  button.disabled = false;
  if (error) {
    toast(error.message);
    return;
  }
  input.value = "";
  await touchSwap(chatRequestId);
  await loadMessages(chatRequestId);
}

function closeChat() {
  document.querySelector("#chatModal")?.remove();
  if (chatChannel) supabase.removeChannel(chatChannel);
  chatChannel = null;
  chatRequestId = null;
}

async function openVideoCall(id) {
  const request = state.requests.find((item) => String(item.id) === String(id));
  if (!request || request.status !== "accepted") {
    toast("Video calls are available after a swap is accepted.");
    return;
  }
  closeVideoCall();
  document.body.insertAdjacentHTML("beforeend", videoModal(request));
  document
    .querySelector("#videoClose")
    .addEventListener("click", closeVideoCall);
  document
    .querySelector("#hangupBtn")
    .addEventListener("click", closeVideoCall);
  document.querySelector("#toggleMic").addEventListener("click", toggleMic);
  document.querySelector("#toggleCam").addEventListener("click", toggleCamera);
  await touchSwap(request.id);

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    const localVideo = document.querySelector("#localVideo");
    if (localVideo) localVideo.srcObject = localStream;
    await startPeerConnection(request);
  } catch (error) {
    setVideoStatus("Camera or microphone permission was blocked.");
    toast("Allow camera and microphone access to start a video call.");
  }
}

async function startPeerConnection(request) {
  const myId = state.session.user.id;
  const partnerId = otherUserId(request);
  const shouldOffer = request.sender_id === myId;
  offerMade = false;
  pendingIce = [];
  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });

  localStream
    .getTracks()
    .forEach((track) => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = (event) => {
    const remoteVideo = document.querySelector("#remoteVideo");
    if (remoteVideo) remoteVideo.srcObject = event.streams[0];
    document.querySelector("#waitingCard")?.classList.add("hidden");
    setVideoStatus(`Connected with ${otherName(request)}`);
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && videoChannel) {
      videoChannel.send({
        type: "broadcast",
        event: "ice",
        payload: { from: myId, candidate: event.candidate.toJSON() },
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const status = peerConnection?.connectionState;
    if (status === "connected")
      setVideoStatus(`Connected with ${otherName(request)}`);
    if (status === "failed" || status === "disconnected")
      setVideoStatus("Connection lost. Try ending the call and joining again.");
  };

  videoChannel = supabase
    .channel(`call:${request.call_room}`, {
      config: { presence: { key: myId }, broadcast: { self: false } },
    })
    .on("presence", { event: "sync" }, async () => {
      const presence = videoChannel.presenceState();
      const people = Object.keys(presence);
      if (people.length >= 2) {
        setVideoStatus(`Connecting to ${otherName(request)}…`);
        if (shouldOffer && !offerMade) {
          offerMade = true;
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          await videoChannel.send({
            type: "broadcast",
            event: "offer",
            payload: { from: myId, to: partnerId, sdp: offer },
          });
        }
      } else {
        setVideoStatus(`Waiting for ${otherName(request)} to join…`);
      }
    })
    .on("broadcast", { event: "offer" }, async ({ payload }) => {
      if (payload.to !== myId) return;
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(payload.sdp),
      );
      await flushIce();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await videoChannel.send({
        type: "broadcast",
        event: "answer",
        payload: { from: myId, to: payload.from, sdp: answer },
      });
    })
    .on("broadcast", { event: "answer" }, async ({ payload }) => {
      if (payload.to !== myId) return;
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(payload.sdp),
      );
      await flushIce();
    })
    .on("broadcast", { event: "ice" }, async ({ payload }) => {
      if (payload.from === myId) return;
      const candidate = new RTCIceCandidate(payload.candidate);
      if (peerConnection.remoteDescription)
        await peerConnection.addIceCandidate(candidate);
      else pendingIce.push(candidate);
    })
    .on("broadcast", { event: "leave" }, ({ payload }) => {
      if (payload.from !== myId) {
        document.querySelector("#waitingCard")?.classList.remove("hidden");
        setVideoStatus(`${otherName(request)} left the call.`);
      }
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED")
        await videoChannel.track({
          user_id: myId,
          joined_at: new Date().toISOString(),
        });
    });
}

async function flushIce() {
  while (pendingIce.length && peerConnection?.remoteDescription) {
    const candidate = pendingIce.shift();
    await peerConnection.addIceCandidate(candidate);
  }
}

function setVideoStatus(text) {
  const status = document.querySelector("#videoStatus");
  if (status) status.textContent = text;
}

function toggleMic() {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  document.querySelector("#toggleMic").textContent = track.enabled
    ? "Mic on"
    : "Mic off";
}

function toggleCamera() {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  document.querySelector("#toggleCam").textContent = track.enabled
    ? "Camera on"
    : "Camera off";
}

function closeVideoCall() {
  const myId = state.session?.user?.id;
  if (videoChannel && myId)
    videoChannel.send({
      type: "broadcast",
      event: "leave",
      payload: { from: myId },
    });
  if (videoChannel && supabase) supabase.removeChannel(videoChannel);
  videoChannel = null;
  peerConnection?.close();
  peerConnection = null;
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  pendingIce = [];
  offerMade = false;
  document.querySelector("#videoModal")?.remove();
}

async function logout() {
  closeChat();
  closeVideoCall();
  await supabase.auth.signOut();
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  document.body.appendChild(element);
  requestAnimationFrame(() => element.classList.add("show"));
  setTimeout(() => {
    element.classList.remove("show");
    setTimeout(() => element.remove(), 220);
  }, 3200);
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.querySelector("#videoModal")) closeVideoCall();
  else if (document.querySelector("#chatModal")) closeChat();
  else if (document.querySelector("#profileModal")) closeProfileModal();
  else if (document.querySelector("#authModal")) closeAuth();
});

window.addEventListener("beforeunload", () => {
  localStream?.getTracks().forEach((track) => track.stop());
  peerConnection?.close();
});

initialize();

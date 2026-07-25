(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const canvas = $("#game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const bg = new Image();
  bg.src = "assets/abandoned-city.png";

  const screens = {
    menu: $("#menu"), hud: $("#hud"), upgrade: $("#upgradeScreen"),
    base: $("#baseScreen"), pause: $("#pauseScreen"), result: $("#resultScreen")
  };

  const saved = JSON.parse(localStorage.getItem("technomancer-save") || "{}");
  const profile = {
    parts: saved.parts || 0,
    upgrades: saved.upgrades || { vitality: 0, power: 0, salvage: 0 }
  };
  const baseDefs = {
    vitality: { name: "Reinforced Chassis", desc: "+10 starting integrity per tier", costs: [30, 75, 150] },
    power: { name: "Overclock Core", desc: "+8% starting damage per tier", costs: [40, 90, 180] },
    salvage: { name: "Recovery Protocol", desc: "+10% parts recovered per tier", costs: [50, 110, 220] }
  };

  const weaponDefs = [
    { id: "blaster", name: "Pulse Blaster", icon: "⌁", rate: .22, damage: 17, speed: 700, color: "#48eaff" },
    { id: "shotgun", name: "Arc Shotgun", icon: "≋", rate: .72, damage: 12, speed: 590, color: "#ffb24b" },
    { id: "tesla", name: "Tesla Gun", icon: "ϟ", rate: .48, damage: 28, speed: 0, color: "#80f6ff" },
    { id: "rocket", name: "Rocket", icon: "➤", rate: 1.05, damage: 68, speed: 410, color: "#ff684b" },
    { id: "drone", name: "Drone", icon: "◇", rate: .42, damage: 15, speed: 610, color: "#a783ff" }
  ];

  let state = "menu";
  let last = performance.now();
  let time = 0;
  let shake = 0;
  let run;
  let player;
  let enemies = [], bullets = [], particles = [], pickups = [], arcs = [], texts = [];
  let keys = {};
  let pointer = { x: W / 2, y: H / 2 };
  let joystick = { active: false, x: 0, y: 0 };
  let mobileAim = { x: 1, y: 0 };
  let toastTimer;

  function save() {
    localStorage.setItem("technomancer-save", JSON.stringify(profile));
    updateBank();
  }
  function updateBank() {
    $("#bankText").textContent = `${profile.parts} PARTS AVAILABLE`;
    $("#baseParts").textContent = profile.parts;
  }
  function showOnly(name) {
    Object.entries(screens).forEach(([key, el]) => el.classList.toggle("hidden", key !== name && !(name === "game" && key === "hud")));
    if (name === "game") screens.hud.classList.remove("hidden");
  }
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1500);
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function angleTo(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function startGame() {
    const maxHp = 100 + profile.upgrades.vitality * 10;
    run = { wave: 0, level: 1, xp: 0, xpNeed: 60, pendingUpgrades: 0, kills: 0, parts: 0, spawnLeft: 0, spawning: false, waveDelay: 1.2, waveCleared: false, bossSpawned: false };
    player = {
      x: W / 2, y: H / 2, r: 16, hp: maxHp, maxHp, speed: 245,
      damage: 1 + profile.upgrades.power * .08, rate: 1, armor: 0, magnet: 85,
      fireTimer: 0, invuln: 0, dash: 0, dashCd: 0, angle: 0,
      activeWeapon: 0, unlocked: [true, false, false, false, false], drones: 0
    };
    enemies = []; bullets = []; particles = []; pickups = []; arcs = []; texts = [];
    state = "running";
    showOnly("game");
    $("#mobileControls").classList.toggle("hidden", innerWidth > 800);
    buildWeaponDock();
    beginWave();
  }

  function beginWave() {
    run.wave++;
    run.waveCleared = false;
    run.bossSpawned = false;
    if (run.wave === 5) {
      run.spawnLeft = 0;
      spawnBoss();
      toast("⚠ OMEGA SIGNAL DETECTED");
    } else {
      run.spawnLeft = 7 + run.wave * 4;
      run.spawning = true;
      run.spawnTimer = .2;
      toast(`WAVE 0${run.wave} // INCOMING`);
    }
    updateHUD();
  }

  function randomEdge() {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) return { x: rand(40, W - 40), y: -30 };
    if (side === 1) return { x: W + 30, y: rand(40, H - 40) };
    if (side === 2) return { x: rand(40, W - 40), y: H + 30 };
    return { x: -30, y: rand(40, H - 40) };
  }

  function spawnEnemy(type) {
    const p = randomEdge();
    const scale = 1 + run.wave * .13;
    const defs = {
      scout: { r: 13, hp: 34, speed: 110, damage: 10, color: "#63eaff", xp: 14, parts: 2 },
      crawler: { r: 11, hp: 23, speed: 165, damage: 8, color: "#9d77ff", xp: 12, parts: 2 },
      heavy: { r: 23, hp: 145, speed: 57, damage: 20, color: "#ff9c45", xp: 35, parts: 6 },
      kamikaze: { r: 12, hp: 26, speed: 205, damage: 30, color: "#ff455c", xp: 18, parts: 3 }
    };
    const d = defs[type];
    enemies.push({ ...p, ...d, type, hp: d.hp * scale, maxHp: d.hp * scale, hit: 0, dead: false, attackCd: 0, phase: rand(0, 10) });
  }

  function spawnBoss() {
    const p = { x: W / 2, y: -65 };
    enemies.push({ ...p, type: "boss", r: 58, hp: 1800, maxHp: 1800, speed: 42, damage: 27, color: "#ff6d31", xp: 250, parts: 100, hit: 0, dead: false, attackCd: 1.5, phase: 0 });
    run.bossSpawned = true;
    $("#bossBar").classList.remove("hidden");
  }

  function chooseType() {
    const r = Math.random();
    if (run.wave >= 4 && r < .18) return "heavy";
    if (run.wave >= 3 && r < .42) return "kamikaze";
    if (run.wave >= 2 && r < .67) return "crawler";
    return "scout";
  }

  function fire() {
    const w = weaponDefs[player.activeWeapon];
    if (!player.unlocked[player.activeWeapon]) return;
    player.fireTimer = w.rate / player.rate;
    const a = player.angle;
    if (w.id === "shotgun") {
      for (let i = -2; i <= 2; i++) makeBullet(a + i * .115 + rand(-.03,.03), w, 1, 1.1);
      burst(player.x + Math.cos(a)*20, player.y + Math.sin(a)*20, w.color, 7, 2);
    } else if (w.id === "tesla") {
      const targets = enemies.filter(e => !e.dead).sort((a,b) => dist(player,a)-dist(player,b));
      let from = player, hits = 0;
      for (const target of targets) {
        if (dist(from,target) < 260 && hits < 3) {
          damageEnemy(target, w.damage * player.damage * (1 - hits*.2));
          arcs.push({ a:{x:from.x,y:from.y}, b:{x:target.x,y:target.y}, life:.13, color:w.color });
          from = target; hits++;
        }
      }
      if (!hits) player.fireTimer *= .55;
    } else if (w.id === "drone") {
      const origin = dronePos(time);
      const target = nearestEnemy(origin, 500);
      if (target) {
        const da = angleTo(origin,target);
        bullets.push({ x:origin.x, y:origin.y, vx:Math.cos(da)*w.speed, vy:Math.sin(da)*w.speed, r:4, damage:w.damage*player.damage, life:1.2, color:w.color, type:"drone", pierce:0 });
      }
    } else {
      makeBullet(a, w, w.id === "rocket" ? 7 : 4, w.id === "rocket" ? 1.8 : 1.25);
      burst(player.x + Math.cos(a)*22, player.y + Math.sin(a)*22, w.color, w.id === "rocket" ? 9 : 4, 1.5);
    }
  }

  function makeBullet(a, w, r, life) {
    bullets.push({
      x: player.x + Math.cos(a)*22, y: player.y + Math.sin(a)*22,
      vx: Math.cos(a)*w.speed, vy: Math.sin(a)*w.speed, r,
      damage: w.damage * player.damage, life, color: w.color, type:w.id, pierce: w.id === "blaster" ? 0 : 0
    });
  }

  function nearestEnemy(from, range=Infinity) {
    let best = null, bd = range;
    for (const e of enemies) {
      const d = dist(from,e);
      if (!e.dead && d < bd) { best=e; bd=d; }
    }
    return best;
  }

  function damageEnemy(e, amount) {
    if (e.dead) return;
    e.hp -= amount;
    e.hit = .09;
    texts.push({ x:e.x, y:e.y-e.r, text:Math.round(amount), color:"#b9f8ff", life:.55, vy:-28 });
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    e.dead = true;
    run.kills++;
    shake = e.type === "boss" ? 20 : Math.max(shake, e.r*.18);
    burst(e.x,e.y,e.color,e.type==="boss"?70:16,e.type==="boss"?6:3);
    pickups.push({ x:e.x+rand(-8,8), y:e.y+rand(-8,8), type:"xp", value:e.xp, r:5, color:"#49eaff" });
    const salvage = Math.ceil(e.parts*(1+profile.upgrades.salvage*.1));
    if (Math.random() < .75 || e.type === "boss") pickups.push({ x:e.x+rand(-10,10), y:e.y+rand(-10,10), type:"part", value:salvage, r:6, color:"#ffb34c" });
    if (e.type === "boss") setTimeout(() => finishRun(true), 1000);
  }

  function hurtPlayer(amount) {
    if (player.invuln > 0) return;
    const real = amount * (1 - player.armor);
    player.hp -= real;
    player.invuln = .55;
    shake = 9;
    burst(player.x, player.y, "#ff3957", 12, 4);
    if (player.hp <= 0) finishRun(false);
  }

  function addXp(value) {
    run.xp += value;
    while (run.xp >= run.xpNeed) {
      run.xp -= run.xpNeed;
      run.level++;
      run.pendingUpgrades++;
      run.xpNeed = Math.round(run.xpNeed * 1.38);
      toast("UPGRADE READY // PRESS E");
    }
    updateUpgradePrompt();
  }

  function updateUpgradePrompt() {
    const el = $("#upgradePrompt");
    el.classList.toggle("hidden", !run || run.pendingUpgrades < 1 || state !== "running");
    if (run && run.pendingUpgrades > 0) {
      el.querySelector("span").textContent = run.pendingUpgrades > 1 ? `${run.pendingUpgrades} UPGRADES READY` : "UPGRADE READY";
    }
  }

  function openPendingUpgrade() {
    if (state !== "running" || !run || run.pendingUpgrades < 1) return;
    state = "upgrade";
    updateUpgradePrompt();
    showUpgrade();
  }

  const upgrades = [
    { id:"damage", icon:"⌁", name:"Overclock Protocol", tag:"OFFENSE", desc:"Push weapon capacitors beyond factory limits.", effect:"+25% ALL DAMAGE", apply(){player.damage*=1.25;} },
    { id:"rate", icon:"↯", name:"Rapid Compiler", tag:"OFFENSE", desc:"Reduce targeting and firing-cycle latency.", effect:"+20% FIRE RATE", apply(){player.rate*=1.2;} },
    { id:"speed", icon:"»", name:"Servo Boost", tag:"MOBILITY", desc:"Route surplus power to locomotion servos.", effect:"+18% MOVE SPEED", apply(){player.speed*=1.18;} },
    { id:"heal", icon:"+", name:"Nanite Repair", tag:"SURVIVAL", desc:"Consume spare material to restore the chassis.", effect:"RESTORE 40% INTEGRITY", apply(){player.hp=Math.min(player.maxHp,player.hp+player.maxHp*.4);} },
    { id:"armor", icon:"⬡", name:"Reactive Plating", tag:"SURVIVAL", desc:"Deploy layered impact-diffusion plating.", effect:"+8% DAMAGE RESIST", apply(){player.armor=Math.min(.45,player.armor+.08);} },
    { id:"magnet", icon:"∩", name:"Scrap Magnet", tag:"UTILITY", desc:"Increase electromagnetic salvage field.", effect:"+45 PICKUP RANGE", apply(){player.magnet+=45;} },
    { id:"shotgun", icon:"≋", name:"Arc Shotgun", tag:"NEW WEAPON", desc:"Five conductive slugs. Close-range devastation.", effect:"UNLOCK WEAPON SLOT 2", rare:true, weapon:1, apply(){unlockWeapon(1);} },
    { id:"tesla", icon:"ϟ", name:"Tesla Conduit", tag:"NEW WEAPON", desc:"Chain lightning through clustered machines.", effect:"UNLOCK WEAPON SLOT 3", rare:true, weapon:2, apply(){unlockWeapon(2);} },
    { id:"rocket", icon:"➤", name:"Siege Rocket", tag:"NEW WEAPON", desc:"Explosive warhead with a wide damage radius.", effect:"UNLOCK WEAPON SLOT 4", rare:true, weapon:3, apply(){unlockWeapon(3);} },
    { id:"drone", icon:"◇", name:"Sentinel Drone", tag:"NEW WEAPON", desc:"An autonomous combat platform orbits you.", effect:"UNLOCK WEAPON SLOT 5", rare:true, weapon:4, apply(){unlockWeapon(4);player.drones=1;} }
  ];

  function showUpgrade() {
    screens.upgrade.classList.remove("hidden");
    const available = upgrades.filter(u => u.weapon == null || !player.unlocked[u.weapon]);
    const chosen = [];
    while (chosen.length < 3 && available.length) chosen.push(available.splice(Math.floor(Math.random()*available.length),1)[0]);
    $("#upgradeCards").innerHTML = chosen.map((u,i)=>`
      <button class="upgrade-card ${u.rare?"rare":""}" data-id="${u.id}">
        <span class="index">0${i+1}</span><div class="upgrade-icon">${u.icon}</div>
        <small>${u.tag}</small><h3>${u.name}</h3><p>${u.desc}</p><span class="effect">${u.effect}</span>
      </button>`).join("");
    document.querySelectorAll(".upgrade-card").forEach(card => card.onclick = () => {
      const u = upgrades.find(x=>x.id===card.dataset.id);
      u.apply();
      run.pendingUpgrades--;
      screens.upgrade.classList.add("hidden");
      screens.hud.classList.remove("hidden");
      state = "running";
      toast(`${u.name.toUpperCase()} INSTALLED`);
      updateUpgradePrompt();
      updateHUD();
    });
  }

  function unlockWeapon(index) {
    player.unlocked[index] = true;
    player.activeWeapon = index;
    buildWeaponDock();
  }

  function buildWeaponDock() {
    $("#weaponDock").innerHTML = weaponDefs.map((w,i)=>`
      <div class="weapon-slot ${player.unlocked[i]?"unlocked":""} ${player.activeWeapon===i?"active":""}">
      <kbd>${i+1}</kbd><b>${player.unlocked[i]?w.icon:"×"}</b><span>${player.unlocked[i]?w.name:"LOCKED"}</span></div>`).join("");
  }

  function updateHUD() {
    if (!player || !run) return;
    $("#healthFill").style.width = `${Math.max(0,player.hp/player.maxHp*100)}%`;
    $("#healthText").textContent = `${Math.ceil(Math.max(0,player.hp))} / ${player.maxHp}`;
    $("#xpFill").style.width = `${run.xp/run.xpNeed*100}%`;
    $("#levelText").textContent = `LEVEL ${run.level}`;
    $("#waveText").textContent = run.wave===5 ? "BOSS" : `WAVE ${String(run.wave).padStart(2,"0")}`;
    $("#enemyText").textContent = `${enemies.filter(e=>!e.dead).length + run.spawnLeft} HOSTILES`;
    $("#partsText").textContent = `${run.parts} PARTS`;
    const boss = enemies.find(e=>e.type==="boss"&&!e.dead);
    if (boss) $("#bossFill").style.width = `${Math.max(0,boss.hp/boss.maxHp*100)}%`;
  }

  function finishRun(victory) {
    if (state === "result") return;
    state = "result";
    profile.parts += run.parts;
    save();
    showOnly("result");
    $("#mobileControls").classList.add("hidden");
    $("#resultTitle").innerHTML = victory ? "PROTOCOL <em>BREACHED</em>" : "RUN <em>TERMINATED</em>";
    $("#resultCopy").textContent = victory ? "The Iron Behemoth is scrap. Its systems are yours." : "Your chassis failed. Your data survived.";
    $("#resultEyebrow").innerHTML = victory ? "<span></span> OMEGA SIGNAL DESTROYED <span></span>" : "<span></span> SIGNAL LOST <span></span>";
    $("#statWaves").textContent = run.wave;
    $("#statKills").textContent = run.kills;
    $("#statParts").textContent = run.parts;
  }

  function abortRun() {
    profile.parts += run.parts;
    save();
    state = "menu";
    showOnly("menu");
    $("#bossBar").classList.add("hidden");
    $("#mobileControls").classList.add("hidden");
  }

  function update(dt) {
    if (state !== "running") return;
    time += dt;
    player.invuln -= dt; player.fireTimer -= dt; player.dashCd -= dt;
    let dx = (keys.d||keys.arrowright?1:0) - (keys.a||keys.arrowleft?1:0) + joystick.x;
    let dy = (keys.s||keys.arrowdown?1:0) - (keys.w||keys.arrowup?1:0) + joystick.y;
    const len = Math.hypot(dx,dy) || 1; dx/=len; dy/=len;
    const speed = player.speed * (player.dash>0 ? 2.7 : 1);
    player.dash -= dt;
    player.x = clamp(player.x + dx*speed*dt, 28, W-28);
    player.y = clamp(player.y + dy*speed*dt, 40, H-32);
    if (innerWidth <= 800) {
      const target = nearestEnemy(player);
      if (target) player.angle = angleTo(player, target);
      else player.angle = Math.atan2(mobileAim.y, mobileAim.x);
    } else player.angle = Math.atan2(pointer.y-player.y,pointer.x-player.x);
    if (player.fireTimer <= 0 && enemies.some(e=>!e.dead)) fire();

    if (run.spawning) {
      run.spawnTimer -= dt;
      if (run.spawnTimer <= 0 && run.spawnLeft > 0) {
        spawnEnemy(chooseType());
        run.spawnLeft--;
        run.spawnTimer = Math.max(.18,.65-run.wave*.06);
      }
      if (run.spawnLeft <= 0) run.spawning=false;
    }

    for (const b of bullets) {
      b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt;
      if (b.type === "enemy") continue;
      for (const e of enemies) {
        if (e.dead || dist(b,e) > b.r+e.r) continue;
        if (b.type === "rocket") {
          for (const other of enemies) if(!other.dead && dist(b,other)<95) damageEnemy(other,b.damage*(1-dist(b,other)/150));
          burst(b.x,b.y,"#ff7545",35,5); shake=11;
        } else damageEnemy(e,b.damage);
        b.life=0; break;
      }
    }
    bullets = bullets.filter(b=>b.life>0 && b.x>-80&&b.x<W+80&&b.y>-80&&b.y<H+80);

    for (const e of enemies) {
      if(e.dead) continue;
      e.hit-=dt; e.attackCd-=dt; e.phase+=dt;
      const a=angleTo(e,player), d=dist(e,player);
      if (e.type === "boss") {
        if (d>190) {e.x+=Math.cos(a)*e.speed*dt;e.y+=Math.sin(a)*e.speed*dt;}
        if(e.attackCd<=0) {
          e.attackCd=1.45;
          for(let i=0;i<12;i++) {
            const ba=i/12*Math.PI*2+time*.3;
            bullets.push({x:e.x,y:e.y,vx:Math.cos(ba)*190,vy:Math.sin(ba)*190,r:6,damage:13,life:4,color:"#ff613d",type:"enemy"});
          }
          shake=5;
        }
      } else {
        const mult=e.type==="crawler" ? 1+.18*Math.sin(e.phase*8) : 1;
        e.x+=Math.cos(a)*e.speed*mult*dt; e.y+=Math.sin(a)*e.speed*mult*dt;
      }
      if(d<e.r+player.r+3) {
        if(e.type==="kamikaze") { hurtPlayer(e.damage); killEnemy(e); }
        else if(e.attackCd<=0) { hurtPlayer(e.damage); e.attackCd=e.type==="boss"?.7:1; }
      }
    }
    // enemy projectiles
    for (const b of bullets) {
      if(b.type==="enemy" && dist(b,player)<b.r+player.r){ hurtPlayer(b.damage); b.life=0; }
    }
    enemies=enemies.filter(e=>!e.dead);

    for (const p of pickups) {
      const d=dist(p,player);
      if(d<player.magnet){const a=angleTo(p,player);p.x+=Math.cos(a)*Math.max(180,500-d)*dt;p.y+=Math.sin(a)*Math.max(180,500-d)*dt;}
      if(d<player.r+p.r+5){if(p.type==="xp")addXp(p.value);else{run.parts+=p.value;texts.push({x:p.x,y:p.y,text:`+${p.value} PARTS`,color:"#ffb24b",life:.8,vy:-25});}p.dead=true;}
    }
    pickups=pickups.filter(p=>!p.dead);
    for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.94;p.vy*=.94;p.life-=dt;}
    particles=particles.filter(p=>p.life>0);
    for(const a of arcs)a.life-=dt; arcs=arcs.filter(a=>a.life>0);
    for(const t of texts){t.y+=t.vy*dt;t.life-=dt;} texts=texts.filter(t=>t.life>0);
    shake*=.88;

    if(!run.spawning && run.spawnLeft===0 && enemies.length===0 && run.wave<5 && state==="running") {
      if (!run.waveCleared) {
        run.waveCleared = true;
        const healthIncrease = player.maxHp * .15;
        player.maxHp = Math.round(player.maxHp + healthIncrease);
        player.hp = Math.min(player.maxHp, player.hp + healthIncrease);
        texts.push({x:player.x,y:player.y-35,text:"+15% MAX INTEGRITY",color:"#63ffae",life:1.4,vy:-18});
        burst(player.x,player.y,"#63ffae",22,2);
        toast(`WAVE 0${run.wave} CLEARED // +15% MAX INTEGRITY`);
      }
      run.waveDelay-=dt;
      if(run.waveDelay<=0){run.waveDelay=1.5;beginWave();}
    }
    updateHUD();
  }

  function burst(x,y,color,count=10,power=3) {
    for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,s=rand(25,80)*power;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:rand(1.5,4),color,life:rand(.25,.75)});}
  }

  function dronePos(t) { return {x:player.x+Math.cos(t*2.2)*52,y:player.y+Math.sin(t*2.2)*36}; }

  function draw() {
    ctx.save();
    if(shake>0) ctx.translate(rand(-shake,shake),rand(-shake,shake));
    if(bg.complete) {
      const scale=Math.max(W/bg.width,H/bg.height), sw=W/scale, sh=H/scale;
      ctx.drawImage(bg,(bg.width-sw)/2,(bg.height-sh)/2,sw,sh,0,0,W,H);
    } else {ctx.fillStyle="#071019";ctx.fillRect(0,0,W,H);}
    ctx.fillStyle="rgba(2,8,13,.18)";ctx.fillRect(0,0,W,H);

    // Ambient grid and sparks
    ctx.strokeStyle="rgba(66,220,242,.055)";ctx.lineWidth=1;
    for(let x=0;x<W;x+=64){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<H;y+=64){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

    if(player && state!=="menu") {
      pickups.forEach(drawPickup);
      bullets.forEach(drawBullet);
      enemies.forEach(drawEnemy);
      arcs.forEach(drawArc);
      particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life*1.8);ctx.fillStyle=p.color;ctx.fillRect(p.x-p.r/2,p.y-p.r/2,p.r,p.r);ctx.globalAlpha=1;});
      drawPlayer();
      texts.forEach(t=>{ctx.globalAlpha=Math.min(1,t.life*3);ctx.fillStyle=t.color;ctx.font="700 12px Chakra Petch";ctx.textAlign="center";ctx.fillText(t.text,t.x,t.y);ctx.globalAlpha=1;});
    }
    ctx.restore();
  }

  function drawPlayer() {
    ctx.save();ctx.translate(player.x,player.y);ctx.rotate(player.angle);
    if(player.invuln>0 && Math.floor(player.invuln*20)%2)ctx.globalAlpha=.35;
    ctx.shadowColor="#48eaff";ctx.shadowBlur=18;
    ctx.fillStyle="#07161b";ctx.strokeStyle="#58efff";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(19,0);ctx.lineTo(6,12);ctx.lineTo(-12,11);ctx.lineTo(-17,0);ctx.lineTo(-12,-11);ctx.lineTo(6,-12);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle="#48eaff";ctx.fillRect(-5,-6,13,12);
    ctx.fillStyle="#d5fbff";ctx.fillRect(10,-3,17,6);
    ctx.strokeStyle="rgba(72,234,255,.45)";ctx.beginPath();ctx.arc(0,0,23+Math.sin(time*4)*2,0,Math.PI*2);ctx.stroke();
    ctx.restore();
    if(player.unlocked[4]) {
      const d=dronePos(time);ctx.save();ctx.translate(d.x,d.y);ctx.rotate(time*3);ctx.shadowColor="#a783ff";ctx.shadowBlur=14;ctx.strokeStyle="#b29aff";ctx.fillStyle="#160f2a";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(9,0);ctx.lineTo(0,9);ctx.lineTo(-9,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    }
  }

  function drawEnemy(e) {
    ctx.save();ctx.translate(e.x,e.y);ctx.rotate(angleTo(e,player));
    ctx.shadowColor=e.color;ctx.shadowBlur=e.hit>0?25:10;ctx.strokeStyle=e.hit>0?"#fff":e.color;ctx.fillStyle="#10171b";ctx.lineWidth=2;
    if(e.type==="scout"){
      ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(4,11);ctx.lineTo(-13,8);ctx.lineTo(-13,-8);ctx.lineTo(4,-11);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle=e.color;ctx.fillRect(2,-3,8,6);
    } else if(e.type==="crawler"){
      ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();ctx.stroke();
      for(let i=-1;i<=1;i+=2){ctx.beginPath();ctx.moveTo(-5,i*6);ctx.lineTo(-15,i*13);ctx.moveTo(5,i*6);ctx.lineTo(14,i*14);ctx.stroke();}
      ctx.fillStyle=e.color;ctx.fillRect(1,-3,7,6);
    } else if(e.type==="heavy"){
      ctx.fillRect(-18,-16,32,32);ctx.strokeRect(-18,-16,32,32);ctx.fillStyle="#293338";ctx.fillRect(-25,-19,8,38);ctx.fillRect(15,-19,8,38);ctx.fillStyle=e.color;ctx.fillRect(0,-4,24,8);
    } else if(e.type==="kamikaze"){
      ctx.rotate(time*3);ctx.beginPath();for(let i=0;i<8;i++){const a=i/8*Math.PI*2,r=i%2?9:15;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(0,0,5+Math.sin(time*12)*2,0,Math.PI*2);ctx.fill();
    } else {
      ctx.rotate(-angleTo(e,player));ctx.rotate(Math.sin(time*.7)*.08);
      ctx.fillStyle="#171c1e";ctx.lineWidth=4;ctx.beginPath();for(let i=0;i<12;i++){const a=i/12*Math.PI*2,r=i%2?52:63;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();ctx.stroke();
      ctx.strokeStyle="#5a2a1d";ctx.lineWidth=10;ctx.beginPath();ctx.arc(0,0,42,time,time+Math.PI*1.55);ctx.stroke();
      ctx.fillStyle=e.color;ctx.shadowBlur=28;ctx.beginPath();ctx.arc(0,0,15+Math.sin(time*4)*2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#1c2528";for(let i=0;i<4;i++){ctx.save();ctx.rotate(i*Math.PI/2);ctx.fillRect(28,-9,47,18);ctx.restore();}
    }
    if(e.type!=="boss" && e.hp<e.maxHp){ctx.rotate(-angleTo(e,player));ctx.fillStyle="#121a1d";ctx.fillRect(-e.r,e.r+7,e.r*2,3);ctx.fillStyle=e.color;ctx.fillRect(-e.r,e.r+7,e.r*2*(e.hp/e.maxHp),3);}
    ctx.restore();
  }

  function drawBullet(b) {
    ctx.save();ctx.translate(b.x,b.y);ctx.shadowColor=b.color;ctx.shadowBlur=14;ctx.fillStyle=b.color;
    if(b.type==="rocket"){ctx.rotate(Math.atan2(b.vy,b.vx));ctx.fillRect(-10,-4,18,8);ctx.fillStyle="#ffc06c";ctx.fillRect(-15,-2,7,4);}
    else {ctx.beginPath();ctx.arc(0,0,b.r,0,Math.PI*2);ctx.fill();}
    ctx.restore();
  }
  function drawPickup(p) {
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(time*2);ctx.shadowColor=p.color;ctx.shadowBlur=15;ctx.strokeStyle=p.color;ctx.fillStyle="rgba(4,15,20,.8)";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,-p.r);ctx.lineTo(p.r,0);ctx.lineTo(0,p.r);ctx.lineTo(-p.r,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  }
  function drawArc(a) {
    ctx.save();ctx.strokeStyle=a.color;ctx.shadowColor=a.color;ctx.shadowBlur=12;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(a.a.x,a.a.y);
    const steps=7;for(let i=1;i<steps;i++){const t=i/steps;ctx.lineTo(a.a.x+(a.b.x-a.a.x)*t+rand(-9,9),a.a.y+(a.b.y-a.a.y)*t+rand(-9,9));}ctx.lineTo(a.b.x,a.b.y);ctx.stroke();ctx.restore();
  }

  function loop(now) {
    const dt=Math.min(.033,(now-last)/1000);last=now;update(dt);draw();requestAnimationFrame(loop);
  }
  requestAnimationFrame((n)=>{last=n;requestAnimationFrame(loop);});

  function renderBase() {
    updateBank();
    $("#baseUpgrades").innerHTML=Object.entries(baseDefs).map(([id,d])=>{
      const tier=profile.upgrades[id], max=tier>=3, cost=max?"MAX":d.costs[tier];
      return `<div class="base-item"><h3>${d.name}</h3><p>${d.desc}</p><div class="tier">${[0,1,2].map(i=>`<i class="${i<tier?"on":""}"></i>`).join("")}</div>
      <button class="buy-button" data-id="${id}" ${max||profile.parts<cost?"disabled":""}>${max?"MAXIMUM TIER":`UPGRADE // ${cost} PARTS`}</button></div>`;
    }).join("");
    document.querySelectorAll(".buy-button").forEach(b=>b.onclick=()=>buyBase(b.dataset.id));
  }
  function buyBase(id) {
    const tier=profile.upgrades[id], cost=baseDefs[id].costs[tier];
    if(tier>=3||profile.parts<cost)return;
    profile.parts-=cost;profile.upgrades[id]++;save();renderBase();toast("BASE SYSTEM UPGRADED");
  }

  $("#startBtn").onclick=startGame;
  $("#againBtn").onclick=startGame;
  $("#baseBtn").onclick=()=>{state="base";showOnly("base");renderBase();};
  $("#returnBtn").onclick=()=>{state="menu";showOnly("menu");$("#bossBar").classList.add("hidden");};
  $("#closeBase").onclick=()=>{state="menu";showOnly("menu");};
  $("#pauseBtn").onclick=()=>{if(state==="running"){state="paused";screens.pause.classList.remove("hidden");screens.hud.classList.add("hidden");}};
  $("#resumeBtn").onclick=()=>{state="running";screens.pause.classList.add("hidden");screens.hud.classList.remove("hidden");last=performance.now();};
  $("#quitBtn").onclick=abortRun;
  addEventListener("keydown",e=>{
    keys[e.key.toLowerCase()]=true;
    if(e.key.toLowerCase()==="e") openPendingUpgrade();
    const n=Number(e.key);if(state==="running"&&n>=1&&n<=5&&player.unlocked[n-1]){player.activeWeapon=n-1;buildWeaponDock();}
    if(e.key==="Escape"){if(state==="running")$("#pauseBtn").click();else if(state==="paused")$("#resumeBtn").click();}
    if(e.code==="Space")dash();
  });
  addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);
  canvas.addEventListener("pointermove",e=>{const r=canvas.getBoundingClientRect();pointer.x=(e.clientX-r.left)/r.width*W;pointer.y=(e.clientY-r.top)/r.height*H;});
  function dash(){if(state==="running"&&player.dashCd<=0){player.dash=.16;player.dashCd=1.5;burst(player.x,player.y,"#48eaff",14,2);}}
  $("#dashBtn").onclick=dash;
  $("#upgradePrompt").onclick=openPendingUpgrade;
  function bindStick(element, input) {
    const knob = element.querySelector("i");
    const updateStick = e => {
      if (!input.active) return;
      const r=element.getBoundingClientRect();
      const dx=e.clientX-(r.left+r.width/2), dy=e.clientY-(r.top+r.height/2);
      const l=Math.hypot(dx,dy), m=Math.min(35,l);
      if (l > 3) {
        input.x=dx/l;
        input.y=dy/l;
        mobileAim.x=input.x;
        mobileAim.y=input.y;
      }
      knob.style.transform=`translate(${input.x*m}px,${input.y*m}px)`;
    };
    element.addEventListener("pointerdown",e=>{input.active=true;element.setPointerCapture(e.pointerId);updateStick(e);});
    element.addEventListener("pointermove",updateStick);
    const end=()=>{input.active=false;knob.style.transform="";input.x=0;input.y=0;};
    element.addEventListener("pointerup",end);
    element.addEventListener("pointercancel",end);
  }
  bindStick($("#joystick"), joystick);
  addEventListener("blur",()=>{if(state==="running")$("#pauseBtn").click();});
  updateBank();
  if (new URLSearchParams(location.search).has("play")) startGame();
})();

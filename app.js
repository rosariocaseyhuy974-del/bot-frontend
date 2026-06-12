(function () {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const canvas = document.getElementById("editorCanvas");
  const ctx = canvas.getContext("2d");
  const gestureLayer = document.getElementById("gestureLayer");
  const doneBtn = document.getElementById("doneBtn");
  const errorText = document.getElementById("errorText");
  const assetsScrollLane = document.getElementById("assetsScrollLane");
  const customItemInput = document.getElementById("customItemInput");
  const bottomSheet = document.getElementById("bottomSheet");
  const confirmRenderBtn = document.getElementById("confirmRenderBtn");
  const invoiceBlock = document.getElementById("invoiceBlock");
  const langSwitch = document.getElementById("langSwitch");
  const tracksLane = document.getElementById("tracksLane");
  const sheetTitle = document.getElementById("sheetTitle");

  const i18n = {
    ru: {
      brand_title: "Collage Editor",
      brand_badge: "Telegram WebApp",
      hint: "Перемещайте, масштабируйте (pinch), вращайте объект",
      upload_label: "Свой (+2⭐)",
      done: "Готово",
      sheet_title: "Настройка анимации",
      confirm_render: "🔥 Запустить ИИ-генерацию",
      loading_session: "Синхронизация сессии...",
      loading_item: "Синхронизация предмета...",
      loading_upload: "ИИ очищает фон ассета...",
      loading_render: "Запекание слоев на ИИ-холсте...",
      error_switch: "Ошибка переключения: ",
      error_upload: "Сбой ИИ-вырезки: ",
      error_submit: "Ошибка передачи: ",
      error_token: "Токен сессии пуст",
      error_auth: "Сервер вернул ошибку авторизации",
      error_empty: "Витрина пуста",
      zone_ears: "Уши",
      zone_eyes: "Глаза",
    },
    en: {
      brand_title: "Collage Editor",
      brand_badge: "Telegram WebApp",
      hint: "Move, scale (pinch), rotate the object",
      upload_label: "Custom (+2⭐)",
      done: "Done",
      sheet_title: "Animation Settings",
      confirm_render: "🔥 Start AI Generation",
      loading_session: "Syncing session...",
      loading_item: "Syncing item...",
      loading_upload: "AI removing background...",
      loading_render: "Baking layers on AI canvas...",
      error_switch: "Switch error: ",
      error_upload: "AI cutout failed: ",
      error_submit: "Submit error: ",
      error_token: "Session token is empty",
      error_auth: "Server returned auth error",
      error_empty: "Showcase is empty",
      zone_ears: "Ears",
      zone_eyes: "Eyes",
    },
  };

  let detectedLang = "ru";
  try {
    const code = tg && tg.initDataUnsafe && tg.initDataUnsafe.user
      ? tg.initDataUnsafe.user.language_code
      : "";
    if (code === "en" || code === "ru") detectedLang = code;
  } catch (_) {}
  const savedLang = localStorage.getItem("lang");
  let currentLang = savedLang || detectedLang;

  function __(key) {
    return (i18n[currentLang] && i18n[currentLang][key]) || key;
  }

  function setLanguage(lang) {
    currentLang = lang;
    try { localStorage.setItem("lang", lang); } catch (_) {}
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (i18n[lang] && i18n[lang][key]) {
        el.textContent = i18n[lang][key];
      }
    });
    if (langSwitch) {
      langSwitch.textContent = lang === "ru" ? "RU" : "EN";
    }
  }

  if (langSwitch) {
    langSwitch.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var next = currentLang === "ru" ? "en" : "ru";
      setLanguage(next);
      generateTracks();
      hapticImpact("light");
    });
  }

  const params = new URLSearchParams(window.location.search);
  const sessionToken = params.get("token");
  const BASE_API_URL = "https://tackle-unvisited-doorbell.ngrok-free.dev";

  let W = 1024;
  let H = 1024;
  canvas.width = W;
  canvas.height = H;

  // LERP Target States
  const targetState = {
    x: W / 2,
    y: H / 2,
    scale: 1.0,
    angle: 0
  };

  // Currently rendered state (interpolates towards targetState)
  const state = {
    x: W / 2,
    y: H / 2,
    scale: 1.0,
    angle: 0
  };

  // State when gesture started
  const gestureStart = {
    x: W / 2,
    y: H / 2,
    scale: 1.0,
    angle: 0
  };

  const images = {
    bg: null,
    item: null,
  };

  let globalAssetsPack = [];
  let currentAssetIndex = 0;
  let accumulatedActions = 30;
  let selectedTrack = 1;

  const smartZones = [
    { x: W * 0.5, y: H * 0.25, label: "ears" },
    { x: W * 0.5, y: H * 0.65, label: "eyes" },
  ];

  let isSheetOpen = false;

  function setError(msg) {
    errorText.textContent = msg || "";
  }

  function hapticImpact(style) {
    try {
      if (tg && tg.HapticFeedback) {
        tg.HapticFeedback.impactOccurred(style || "light");
      }
    } catch (_) {}
  }

  function loadImage(base64Data) {
    return new Promise(function (resolve, reject) {
      if (!base64Data) {
        reject(new Error("Base64 stream empty."));
        return;
      }
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Base64 decode failed.")); };
      img.src = base64Data;
    });
  }

  function clampScale(v) {
    return Math.min(8, Math.max(0.05, v));
  }

  function constrainPosition(pos) {
    pos.x = Math.min(W, Math.max(0, pos.x));
    pos.y = Math.min(H, Math.max(0, pos.y));
  }

  function draw() {
    if (!images.bg || !images.item) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(images.bg, 0, 0, W, H);

    var itemW = images.item.width;
    var itemH = images.item.height;

    ctx.save();
    ctx.translate(state.x, state.y);
    ctx.rotate((state.angle * Math.PI) / 180);
    ctx.scale(state.scale, state.scale);

    var aspect = itemW / itemH;
    var targetW, targetH;
    if (itemW > itemH) {
      targetW = 358;
      targetH = 358 / aspect;
    } else {
      targetH = 358;
      targetW = 358 * aspect;
    }

    ctx.drawImage(images.item, -targetW / 2, -targetH / 2, targetW, targetH);
    ctx.restore();
  }

  // Smart Snap Magnet logic with LERP
  function checkSmartZones() {
    if (!images.item) return false;
    for (var i = 0; i < smartZones.length; i++) {
      var zone = smartZones[i];
      var dx = targetState.x - zone.x;
      var dy = targetState.y - zone.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 40) {
        targetState.x = zone.x;
        targetState.y = zone.y;
        return i; // Returns snapped zone index
      }
    }
    return -1;
  }

  function setupTouchEvents() {
    gestureLayer.style.touchAction = "none";

    const tState = {
      startX: 0, startY: 0,
      startDist: 0, startAngle: 0,
      pointerCount: 0,
      isSnapped: false,
      snappedZoneIndex: -1
    };

    gestureLayer.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var touches = e.touches;
      
      // Sycn targetState to state on start to avoid jumping if lerp was running
      targetState.x = state.x;
      targetState.y = state.y;
      targetState.scale = state.scale;
      targetState.angle = state.angle;
      
      if (touches.length === 1) {
        tState.startX = touches[0].clientX;
        tState.startY = touches[0].clientY;
        gestureStart.x = targetState.x;
        gestureStart.y = targetState.y;
        tState.isSnapped = false;
        tState.snappedZoneIndex = -1;
      } else if (touches.length === 2) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        tState.startDist = Math.sqrt(dx * dx + dy * dy);
        tState.startAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        gestureStart.scale = targetState.scale;
        gestureStart.angle = targetState.angle;
      }
      tState.pointerCount = touches.length;
      hapticImpact("light");
    }, { passive: false });

    gestureLayer.addEventListener('touchmove', function (e) {
      e.preventDefault();
      var touches = e.touches;
      var rect = canvas.getBoundingClientRect();
      var scaleX = W / rect.width;
      var scaleY = H / rect.height;

      if (touches.length === 1) {
        if (tState.pointerCount > 1) {
          tState.startX = touches[0].clientX;
          tState.startY = touches[0].clientY;
          gestureStart.x = targetState.x;
          gestureStart.y = targetState.y;
          tState.isSnapped = false;
        }

        const deltaFingerX = (touches[0].clientX - tState.startX) * scaleX;
        const deltaFingerY = (touches[0].clientY - tState.startY) * scaleY;
        const wantedX = gestureStart.x + deltaFingerX;
        const wantedY = gestureStart.y + deltaFingerY;

        if (tState.isSnapped) {
          // Calculate distance between current finger position and snapped zone
          const zone = smartZones[tState.snappedZoneIndex];
          const distToZone = Math.sqrt(Math.pow(wantedX - zone.x, 2) + Math.pow(wantedY - zone.y, 2));
          
          if (distToZone > 65) {
            // Unsnap!
            tState.isSnapped = false;
            tState.snappedZoneIndex = -1;
            tState.startX = touches[0].clientX;
            tState.startY = touches[0].clientY;
            gestureStart.x = state.x;
            gestureStart.y = state.y;
            targetState.x = state.x;
            targetState.y = state.y;
            hapticImpact("light");
          }
        } else {
          targetState.x = wantedX;
          targetState.y = wantedY;
          constrainPosition(targetState);
          
          // Check if we hit a smart zone
          const zoneIdx = checkSmartZones();
          if (zoneIdx !== -1) {
            tState.isSnapped = true;
            tState.snappedZoneIndex = zoneIdx;
            hapticImpact("medium");
          }
        }
      } else if (touches.length === 2) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var angle = Math.atan2(dy, dx) * (180 / Math.PI);

        if (tState.pointerCount < 2) {
          tState.startDist = dist;
          tState.startAngle = angle;
          gestureStart.scale = targetState.scale;
          gestureStart.angle = targetState.angle;
        }
        
        if (tState.startDist > 0) {
          targetState.scale = clampScale(gestureStart.scale * (dist / tState.startDist));
        }
        targetState.angle = (gestureStart.angle + angle - tState.startAngle) % 360;
      }
      tState.pointerCount = touches.length;
    }, { passive: false });

    gestureLayer.addEventListener('touchend', function (e) {
      if (e.touches.length > 0) {
        var touches = e.touches;
        if (touches.length === 1) {
          tState.startX = touches[0].clientX;
          tState.startY = touches[0].clientY;
          gestureStart.x = targetState.x;
          gestureStart.y = targetState.y;
          tState.isSnapped = false;
        }
        tState.pointerCount = touches.length;
      } else {
        tState.pointerCount = 0;
      }
    });
  }

  async function switchActiveAsset(index) {
    if (!globalAssetsPack || globalAssetsPack.length === 0) return;
    try {
      setError(__("loading_item"));
      currentAssetIndex = index;
      var assetData = globalAssetsPack[index];
      var itemImg = await loadImage(assetData.b64);
      images.item = itemImg;

      document.querySelectorAll(".asset-card").forEach(function (card, i) {
        if (i === index) card.classList.add("active");
        else card.classList.remove("active");
      });

      setError("");
    } catch (err) {
      setError(__("error_switch") + err.message);
    }
  }

  function buildWardrobeCarouselUI() {
    if (!assetsScrollLane) return;

    var uploadWrapper = assetsScrollLane.querySelector(".upload-card-wrapper");
    assetsScrollLane.innerHTML = "";
    if (uploadWrapper) {
      assetsScrollLane.appendChild(uploadWrapper);
    }

    globalAssetsPack.forEach(function (asset, index) {
      var card = document.createElement("div");
      card.className = "asset-card";
      if (index === currentAssetIndex) card.classList.add("active");

      var img = document.createElement("img");
      img.src = asset.b64;

      card.appendChild(img);

      card.addEventListener('touchstart', function (e) {
        e.preventDefault();
        switchActiveAsset(index);
        hapticImpact("light");
      });

      assetsScrollLane.appendChild(card);
    });

    requestAnimationFrame(updateCarouselFocus);
  }

  function initCustomItemUploader() {
    if (!customItemInput) return;
    customItemInput.onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;

      setError(__("loading_upload"));
      var reader = new FileReader();
      reader.onload = async function (evt) {
        var base64Raw = evt.target.result;
        try {
          var response = await fetch(BASE_API_URL + "/upload_custom", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: sessionToken,
              image_b64: base64Raw,
            }),
          });

          if (!response.ok) throw new Error("AI segmentation failed.");
          var resData = await response.json();

          var newAsset = {
            path: resData.path,
            b64: resData.item_b64,
          };

          globalAssetsPack.unshift(newAsset);
          buildWardrobeCarouselUI();
          await switchActiveAsset(0);
          hapticImpact("medium");
        } catch (err) {
          setError(__("error_upload") + err.message);
        }
      };
      reader.readAsDataURL(file);
    };
  }

  function updateCarouselFocus() {
    if (!assetsScrollLane) return;
    var laneRect = assetsScrollLane.getBoundingClientRect();
    var laneCenter = laneRect.left + laneRect.width / 2;
    var cards = assetsScrollLane.querySelectorAll(".asset-card");
    var closestCard = null;
    var closestDist = Infinity;

    cards.forEach(function (card) {
      var cardRect = card.getBoundingClientRect();
      var cardCenter = cardRect.left + cardRect.width / 2;
      var dist = Math.abs(cardCenter - laneCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closestCard = card;
      }
    });

    cards.forEach(function (card) {
      card.style.transform = "scale(0.9)";
      card.style.opacity = "0.5";
      card.style.boxShadow = "0 4px 16px rgba(0,0,0,0.2)";
      card.style.borderColor = "";
    });

    if (closestCard) {
      closestCard.style.transform = "scale(1.1)";
      closestCard.style.opacity = "1";
      closestCard.style.boxShadow = "0 0 20px var(--accent-glow)";
      closestCard.style.borderColor = "#0ea5e9";
    }
  }

  if (assetsScrollLane) {
    let scrollTimeout = null;
    assetsScrollLane.addEventListener("scroll", function () {
      updateCarouselFocus();
      
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(function () {
        hapticImpact("light");
      }, 80);
    });
  }

  function openBottomSheet() {
    if (isSheetOpen) return;
    isSheetOpen = true;
    bottomSheet.classList.add("open");
    hapticImpact("medium");
    if (invoiceBlock) {
      var price = currentLang === "en" ? 20 : accumulatedActions;
      invoiceBlock.textContent = (currentLang === "en" ? "25 Actions / " : "") + price + " ⭐️";
    }
    generateTracks();
  }

  function closeBottomSheet() {
    if (!isSheetOpen) return;
    isSheetOpen = false;
    bottomSheet.classList.remove("open");
    hapticImpact("light");
  }

  function generateTracks() {
    if (!tracksLane) return;
    var categories = ["liveportrait", "sadtalker"];
    var trackLabels = {
      ru: ["🎬 Track #1", "🎬 Track #2"],
      en: ["🎬 Track #1", "🎬 Track #2"]
    };
    tracksLane.innerHTML = "";
    var labels = trackLabels[currentLang] || trackLabels.ru;
    categories.forEach(function (cat, idx) {
      var btn = document.createElement("button");
      btn.className = "bs-track" + (idx === 0 ? " active" : "");
      btn.setAttribute("data-track", String(idx + 1));
      btn.textContent = labels[idx] || ("Track #" + (idx + 1));
      tracksLane.appendChild(btn);
    });
    selectedTrack = 1;
  }

  function initBottomSheet() {
    doneBtn.addEventListener('touchstart', function (e) {
      e.preventDefault();
      openBottomSheet();
    });

    sheetTitle.addEventListener('touchstart', function (e) {
      e.preventDefault();
      closeBottomSheet();
    });

    tracksLane.addEventListener('touchstart', function (e) {
      var btn = e.target.closest(".bs-track");
      if (!btn) return;
      tracksLane.querySelectorAll(".bs-track").forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      selectedTrack = parseInt(btn.getAttribute("data-track"), 10) || 1;
      hapticImpact("light");
    });

    confirmRenderBtn.addEventListener('touchstart', async function (e) {
      e.preventDefault();
      confirmRenderBtn.disabled = true;
      confirmRenderBtn.classList.add("loading");
      hapticImpact("medium");

      setError(__("loading_render"));

      var currentAssetPath = globalAssetsPack[currentAssetIndex]
        ? globalAssetsPack[currentAssetIndex].path
        : "";

      var payload = {
        x: Math.round(state.x),
        y: Math.round(state.y),
        scale: Number(state.scale.toFixed(4)),
        angle: Math.round(state.angle),
        chosen_path: currentAssetPath,
        track: selectedTrack,
      };

      try {
        var response = await fetch(BASE_API_URL + "/submit_coords", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
          },
          body: JSON.stringify({
            token: sessionToken,
            coords: payload,
          }),
        });

        if (response.ok) {
          setError("");
          closeBottomSheet();
          hapticImpact("heavy");
          if (tg && typeof tg.close === "function") {
            setTimeout(function () { tg.close(); }, 400);
          }
        } else {
          var errData = await response.json();
          throw new Error(errData.error || "Database gateway error.");
        }
      } catch (err) {
        setError(__("error_submit") + err.message);
      } finally {
        confirmRenderBtn.disabled = false;
        confirmRenderBtn.classList.remove("loading");
      }
    });
  }

  // Gyroscope Parallax variables
  const targetTilt = { x: 0, y: 0 };
  const currentTilt = { x: 0, y: 0 };

  function initOrientationParallax() {
    if (!window.DeviceOrientationEvent) return;
    window.addEventListener(
      "deviceorientation",
      function (e) {
        var gamma = e.gamma || 0; // Left-to-right tilt
        var beta = e.beta || 0;   // Front-to-back tilt
        
        // Clamp orientation angles to avoid excessive scaling
        var clampedGamma = Math.max(-25, Math.min(25, gamma));
        var clampedBeta = Math.max(-25, Math.min(25, beta));
        
        targetTilt.x = (clampedGamma / 25) * 16; // translation in pixels
        targetTilt.y = (clampedBeta / 25) * 16;
      },
      { passive: true }
    );
  }

  // Continuous LERP render tick loop (60 FPS)
  function tick() {
    // ⚡ LERP (Linear Interpolation) factors
    const LERP_FACTOR = 0.22;
    const TILT_LERP = 0.08;

    // 1. Interpolate accessory position
    state.x += (targetState.x - state.x) * LERP_FACTOR;
    state.y += (targetState.y - state.y) * LERP_FACTOR;
    state.scale += (targetState.scale - state.scale) * LERP_FACTOR;
    
    // 2. Shortest-path angle interpolation
    let diffAngle = targetState.angle - state.angle;
    diffAngle = ((diffAngle + 180) % 360) - 180;
    if (diffAngle < -180) diffAngle += 360;
    state.angle += diffAngle * LERP_FACTOR;

    // 3. Interpolate Spline 3D Tilt
    currentTilt.x += (targetTilt.x - currentTilt.x) * TILT_LERP;
    currentTilt.y += (targetTilt.y - currentTilt.y) * TILT_LERP;

    // Apply CSS 3D matrix Tilt to Spline-viewer container
    const spline = document.getElementById("splineBg");
    if (spline) {
      const rotY = (currentTilt.x / 16) * 5;  // Rotate Y based on horizontal tilt
      const rotX = -(currentTilt.y / 16) * 5; // Rotate X based on vertical tilt
      spline.style.transform = `perspective(1000px) translate3d(${currentTilt.x}px, ${currentTilt.y}px, 0) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
    }

    // Redraw Canvas Frame
    draw();

    requestAnimationFrame(tick);
  }

  async function init() {
    if (!sessionToken) {
      setError(__("error_token"));
      return;
    }

    try {
      setError(__("loading_session"));

      var response = await fetch(BASE_API_URL + "/get_state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ token: sessionToken }),
      });

      if (!response.ok) {
        throw new Error(__("error_auth"));
      }

      var storeData = await response.json();

      globalAssetsPack = storeData.assets_pack || [];
      if (globalAssetsPack.length === 0) {
        throw new Error(__("error_empty"));
      }

      accumulatedActions = storeData.accumulated_actions || 30;

      var bgImg = await loadImage(storeData.bg);
      var itemImg = await loadImage(globalAssetsPack[0].b64);

      images.bg = bgImg;
      images.item = itemImg;

      targetState.x = W / 2;
      targetState.y = H / 2;
      targetState.angle = 0;

      var maxStartSize = W * 0.35;
      var fitScale = maxStartSize / Math.max(itemImg.width, itemImg.height);
      targetState.scale = clampScale(fitScale);

      // Instantly sync initial state to avoid slider effect on first load
      state.x = targetState.x;
      state.y = targetState.y;
      state.angle = targetState.angle;
      state.scale = targetState.scale;

      setupTouchEvents();
      buildWardrobeCarouselUI();
      initCustomItemUploader();
      initBottomSheet();
      initOrientationParallax();

      // Launch continuous 60FPS tick rendering
      requestAnimationFrame(tick);

      doneBtn.disabled = false;
      setError("");
    } catch (err) {
      setError(err.message || "Canvas build error.");
    }
  }

  setLanguage(currentLang);
  init();
})();

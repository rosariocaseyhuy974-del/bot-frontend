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
      upload_label: "Свой (+2\u2B50)",
      done: "Готово",
      sheet_title: "Настройка анимации",
      confirm_render: "\uD83D\uDD25 Запустить ИИ-генерацию",
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
      upload_label: "Custom (+2\u2B50)",
      done: "Done",
      sheet_title: "Animation Settings",
      confirm_render: "\uD83D\uDD25 Start AI Generation",
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
    });
  }

  const params = new URLSearchParams(window.location.search);
  const sessionToken = params.get("token");
  const BASE_API_URL = "https://tackle-unvisited-doorbell.ngrok-free.dev";

  let W = 1024;
  let H = 1024;
  canvas.width = W;
  canvas.height = H;

  const state = {
    x: W / 2,
    y: H / 2,
    scale: 1.0,
    angle: 0,
  };

  const gestureStart = {
    x: state.x,
    y: state.y,
    scale: state.scale,
    angle: state.angle,
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

  let snapAnimId = null;
  let rafId = 0;
  let scrollRafId = null;
  let orientationRafId = null;
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

  function constrainPosition() {
    if (!images.item) return;
    state.x = Math.min(W, Math.max(0, state.x));
    state.y = Math.min(H, Math.max(0, state.y));
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

  function requestDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () {
      rafId = 0;
      draw();
    });
  }

  function snapToZone(targetX, targetY) {
    if (snapAnimId) cancelAnimationFrame(snapAnimId);
    function step() {
      var dx = targetX - state.x;
      var dy = targetY - state.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.5) {
        state.x = targetX;
        state.y = targetY;
        snapAnimId = null;
        requestDraw();
        return;
      }
      state.x += dx * 0.7;
      state.y += dy * 0.7;
      constrainPosition();
      requestDraw();
      snapAnimId = requestAnimationFrame(step);
    }
    snapAnimId = requestAnimationFrame(step);
  }

  function checkSmartZones() {
    if (!images.item) return;
    for (var i = 0; i < smartZones.length; i++) {
      var zone = smartZones[i];
      var dx = state.x - zone.x;
      var dy = state.y - zone.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 35) {
        snapToZone(zone.x, zone.y);
        hapticImpact("light");
        return;
      }
    }
  }

  function setupTouchEvents() {
    gestureLayer.style.touchAction = "none";

    var tState = {
      startX: 0, startY: 0,
      startDist: 0, startAngle: 0,
      pointerCount: 0
    };

    gestureLayer.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (snapAnimId) {
        cancelAnimationFrame(snapAnimId);
        snapAnimId = null;
      }
      var touches = e.touches;
      if (touches.length === 1) {
        tState.startX = touches[0].clientX;
        tState.startY = touches[0].clientY;
        gestureStart.x = state.x;
        gestureStart.y = state.y;
      } else if (touches.length === 2) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        tState.startDist = Math.sqrt(dx * dx + dy * dy);
        tState.startAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        gestureStart.scale = state.scale;
        gestureStart.angle = state.angle;
      }
      tState.pointerCount = touches.length;
    }, { passive: false });

    gestureLayer.addEventListener('touchmove', function (e) {
      e.preventDefault();
      var touches = e.touches;

      if (touches.length === 1) {
        if (tState.pointerCount > 1) {
          tState.startX = touches[0].clientX;
          tState.startY = touches[0].clientY;
          gestureStart.x = state.x;
          gestureStart.y = state.y;
        }
        var rect = canvas.getBoundingClientRect();
        var scaleX = W / rect.width;
        var scaleY = H / rect.height;
        state.x = gestureStart.x + (touches[0].clientX - tState.startX) * scaleX;
        state.y = gestureStart.y + (touches[0].clientY - tState.startY) * scaleY;
        constrainPosition();
        checkSmartZones();
        requestDraw();
      } else if (touches.length === 2) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var angle = Math.atan2(dy, dx) * (180 / Math.PI);

        if (tState.pointerCount < 2) {
          tState.startDist = dist;
          tState.startAngle = angle;
          gestureStart.scale = state.scale;
          gestureStart.angle = state.angle;
        }
        if (tState.startDist > 0) {
          state.scale = clampScale(gestureStart.scale * (dist / tState.startDist));
        }
        state.angle = (gestureStart.angle + angle - tState.startAngle) % 360;
        requestDraw();
      }
      tState.pointerCount = touches.length;
    }, { passive: false });

    gestureLayer.addEventListener('touchend', function (e) {
      if (e.touches.length > 0) {
        var touches = e.touches;
        if (touches.length === 1) {
          tState.startX = touches[0].clientX;
          tState.startY = touches[0].clientY;
          gestureStart.x = state.x;
          gestureStart.y = state.y;
        }
        tState.pointerCount = touches.length;
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
      requestDraw();
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
      card.style.opacity = "0.6";
      card.style.boxShadow = "0 4px 16px rgba(0,0,0,0.2)";
      card.style.borderColor = "";
    });

    if (closestCard) {
      closestCard.style.transform = "scale(1.15)";
      closestCard.style.opacity = "1";
      closestCard.style.boxShadow = "0 0 15px rgba(14,165,233,0.6)";
      closestCard.style.borderColor = "#0ea5e9";
    }
  }

  if (assetsScrollLane) {
    assetsScrollLane.addEventListener("scroll", function () {
      if (scrollRafId) return;
      scrollRafId = requestAnimationFrame(function () {
        scrollRafId = null;
        updateCarouselFocus();
        hapticImpact("light");
      });
    });
  }

  function openBottomSheet() {
    if (isSheetOpen) return;
    isSheetOpen = true;
    bottomSheet.classList.add("open");
    hapticImpact("light");
    if (invoiceBlock) {
      var price = currentLang === "en" ? 20 : accumulatedActions;
      invoiceBlock.textContent = (currentLang === "en" ? "25 Actions / " : "") + price + " \u2B50";
    }
    generateTracks();
  }

  function closeBottomSheet() {
    if (!isSheetOpen) return;
    isSheetOpen = false;
    bottomSheet.classList.remove("open");
  }

  function generateTracks() {
    if (!tracksLane) return;
    var categories = ["liveportrait", "sadtalker"];
    var trackLabels = {
      ru: ["\uD83C\uDFAC Track #1", "\uD83C\uDFAC Track #2"],
      en: ["\uD83C\uDFAC Track #1", "\uD83C\uDFAC Track #2"]
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
      confirmRenderBtn.disabled = true;
      confirmRenderBtn.classList.add("loading");

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
          hapticImpact("light");
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

  function initOrientationParallax() {
    if (!window.DeviceOrientationEvent) return;
    window.addEventListener(
      "deviceorientation",
      function (e) {
        if (orientationRafId) return;
        orientationRafId = requestAnimationFrame(function () {
          orientationRafId = null;
          var gamma = e.gamma || 0;
          var beta = e.beta || 0;
          var clampedGamma = Math.max(-30, Math.min(30, gamma));
          var clampedBeta = Math.max(-30, Math.min(30, beta));
          var translateX = (clampedGamma / 30) * 15;
          var translateY = (clampedBeta / 30) * 15;
          var spline = document.querySelector("spline-viewer");
          if (spline) {
            spline.style.transform = "translate(" + translateX + "px, " + translateY + "px)";
          }
        });
      },
      { passive: true }
    );
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

      state.x = W / 2;
      state.y = H / 2;
      state.angle = 0;

      var maxStartSize = W * 0.35;
      var fitScale = maxStartSize / Math.max(itemImg.width, itemImg.height);
      state.scale = clampScale(fitScale);

      setupTouchEvents();
      buildWardrobeCarouselUI();
      initCustomItemUploader();
      initBottomSheet();
      initOrientationParallax();

      doneBtn.disabled = false;
      setError("");
      requestDraw();
    } catch (err) {
      setError(err.message || "Canvas build error.");
    }
  }

  setLanguage(currentLang);
  init();
})();

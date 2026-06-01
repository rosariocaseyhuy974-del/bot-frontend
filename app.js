(function () {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const canvas = document.getElementById("editorCanvas");
  const canvasWrap = document.getElementById("canvasWrap");
  const ctx = canvas.getContext("2d");
  const gestureLayer = document.getElementById("gestureLayer");
  const doneBtn = document.getElementById("doneBtn");
  const errorText = document.getElementById("errorText");

  const params = new URLSearchParams(window.location.search);
  const rawBgUrl = params.get("bg");
  const rawItemUrl = params.get("item");
  const ratioParam = (params.get("ratio") || "1:1").trim();

  let W = 1024;
  let H = 1024;
  if (ratioParam === "3:4") {
    W = 768;
    H = 1024;
    canvasWrap.style.setProperty("--canvas-ratio", "3 / 4");
  } else {
    canvasWrap.style.setProperty("--canvas-ratio", "1 / 1");
  }
  canvas.width = W;
  canvas.height = H;

  const state = {
    x: W / 2,
    y: H / 2,
    scale: 1,
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

  function setError(msg) {
    errorText.textContent = msg || "";
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error("URL изображения не передан."));
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous"; // Полное снятие ограничений CORS для локальных Data URL ресурсов
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Не удалось загрузить ресурс. Проверьте валидность строки Base64."));
      img.src = url;
    });
  }

  function draw() {
    if (!images.bg || !images.item) return;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(images.bg, 0, 0, W, H);

    const itemW = images.item.width;
    const itemH = images.item.height;

    ctx.save();
    ctx.translate(state.x, state.y);
    ctx.rotate((state.angle * Math.PI) / 180);
    ctx.scale(state.scale, state.scale);
    ctx.drawImage(images.item, -itemW / 2, -itemH / 2);
    ctx.restore();
  }

  function constrainPosition() {
    if (!images.item) return;

    const itemW = images.item.width * state.scale;
    const itemH = images.item.height * state.scale;
    const rad = (state.angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));

    const halfX = (itemW * cos + itemH * sin) / 2;
    const halfY = (itemW * sin + itemH * cos) / 2;

    if (halfX * 2 >= W) {
      state.x = W / 2;
    } else {
      state.x = Math.min(W - halfX, Math.max(halfX, state.x));
    }

    if (halfY * 2 >= H) {
      state.y = H / 2;
    } else {
      state.y = Math.min(H - halfY, Math.max(halfY, state.y));
    }
  }

  let rafId = 0;
  function requestDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      draw();
    });
  }

  function clampScale(v) {
    return Math.min(8, Math.max(0.05, v));
  }

  function setupGestures() {
    if (!window.Hammer) {
      setError("Критическая ошибка: библиотека Hammer.js не найдена.");
      return;
    }

    const manager = new Hammer.Manager(gestureLayer);
    const pan = new Hammer.Pan({ threshold: 0, pointers: 0 });
    const pinch = new Hammer.Pinch({ threshold: 0 });
    const rotate = new Hammer.Rotate({ threshold: 0 });

    pinch.recognizeWith([pan, rotate]);
    rotate.recognizeWith([pan, pinch]);
    manager.add([pan, pinch, rotate]);

    manager.on("panstart", () => {
      gestureStart.x = state.x;
      gestureStart.y = state.y;
    });

    manager.on("panmove", (e) => {
      state.x = gestureStart.x + e.deltaX;
      state.y = gestureStart.y + e.deltaY;
      constrainPosition();
      requestDraw();
    });

    manager.on("pinchstart", () => {
      gestureStart.scale = state.scale;
    });

    manager.on("pinchmove", (e) => {
      state.scale = clampScale(gestureStart.scale * e.scale);
      constrainPosition();
      requestDraw();
    });

    manager.on("rotatestart", () => {
      gestureStart.angle = state.angle;
    });

    manager.on("rotatemove", (e) => {
      state.angle = gestureStart.angle + e.rotation;
      constrainPosition();
      requestDraw();
    });
  }

  function initDoneButton() {
    doneBtn.addEventListener("click", () => {
      const payload = {
        x: Math.round(state.x),
        y: Math.round(state.y),
        scale: Number(state.scale.toFixed(4)),
        angle: Math.round(state.angle),
      };

      if (tg && typeof tg.sendData === "function") {
        tg.sendData(JSON.stringify(payload));
        tg.close();
      } else {
        alert("Успешно сформировано: " + JSON.stringify(payload));
      }
    });
  }

  async function init() {
    if (!rawBgUrl || !rawItemUrl) {
      setError("Ошибка: отсутствуют обязательные query-параметры генерации.");
      return;
    }

    // Декодируем URL и восстанавливаем корректные бинарные пробелы в Base64 строках
    const bgUrl = decodeURIComponent(rawBgUrl.trim()).replace(/ /g, "+");
    const itemUrl = decodeURIComponent(rawItemUrl.trim()).replace(/ /g, "+");

    try {
      setError("ИИ-Конвейер: Десериализация слоев...");
      const [bgImg, itemImg] = await Promise.all([loadImage(bgUrl), loadImage(itemUrl)]);
      images.bg = bgImg;
      images.item = itemImg;

      state.x = W / 2;
      state.y = H / 2;
      state.angle = 0;

      const maxStartSize = W * 0.35;
      const fitScale = maxStartSize / Math.max(itemImg.width, itemImg.height);
      state.scale = clampScale(fitScale);
      constrainPosition();

      draw();
      setupGestures();
      initDoneButton();

      doneBtn.disabled = false;
      setError("");
    } catch (err) {
      setError(err.message || "Ошибка построения интерактивного холста.");
    }
  }

  init();
})();
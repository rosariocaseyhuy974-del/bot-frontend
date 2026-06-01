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
  const sessionToken = params.get("token");

  // Базовый адрес вашего API шлюза раздачи
  const BASE_API_URL = "https://tackle-unvisited-doorbell.ngrok-free.dev";

  let W = 1024;
  let H = 1024;
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

  function loadImage(base64Data) {
    return new Promise((resolve, reject) => {
      if (!base64Data) {
        reject(new Error("Поток Base64 пуст."));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Критическая ошибка десериализации потока Base64."));
      img.src = base64Data;
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
    doneBtn.addEventListener("click", async () => {
      doneBtn.disabled = true;
      setError("Сохранение слоев фабрики...");

      const payload = {
        x: Math.round(state.x),
        y: Math.round(state.y),
        scale: Number(state.scale.toFixed(4)),
        angle: Math.round(state.angle),
      };

      try {
        const response = await fetch(`${BASE_API_URL}/submit_coords`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true"
          },
          body: JSON.stringify({
            token: sessionToken,
            coords: payload
          })
        });

        if (response.ok) {
          setError("");
          if (tg && typeof tg.close === "function") {
            tg.close(); // Жестко гасим WebView-окно, бот сам пришлет результат
          }
        } else {
          const errData = await response.json();
          throw new Error(errData.error || "Ошибка шлюза СУБД.");
        }
      } catch (err) {
        doneBtn.disabled = false;
        setError("Ошибка передачи: " + err.message);
      }
    });
  }

  async function init() {
    if (!sessionToken) {
      setError("Критическая ошибка: токен сессии WebApp пуст.");
      return;
    }

    try {
      setError("Синхронизация сессии ИИ-станка...");
      
      const response = await fetch(`${BASE_API_URL}/get_state`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true"
        },
        body: JSON.stringify({ token: sessionToken })
      });

      if (!response.ok) {
        throw new Error("Сервер вернул ошибку авторизации сессии.");
      }

      const storeData = await response.json();
      
      const [bgImg, itemImg] = await Promise.all([
        loadImage(storeData.bg),
        loadImage(storeData.item)
      ]);

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
(function () {
  var stage = document.getElementById("mascotStage");
  var container = document.getElementById("mascotContainer");
  var labelEl = document.getElementById("mascotLabel");
  if (!stage || !container) return;

  var currentState = null;
  var currentAnim = null;
  var hideTimer = null;

  var colors = window.__MASCOT_COLORS || {};
  var labels = {
    thinking: { text: "Thinking...", color: colors.thinking || "#FF8C42" },
    needsInput: { text: "hey! look here!", color: colors.needsInput || "#E85D5D" },
    complete: { text: "Done!", color: colors.complete || "#6BCB77" }
  };

  // Map real VibeState strings → mascot animation keys
  function mapState(vibeState) {
    switch (vibeState) {
      case "aiThinking":
      case "aiGenerating":
      case "userPrompting":
        return "thinking";
      case "aiWaitingForInput":
      case "aiNeedsInput":
        return "needsInput";
      case "aiComplete":
      case "userAccepted":
        return "complete";
      default:
        return null; // idle, userCoding, userDeclined → hide
    }
  }

  function getAnimData(key) {
    return window.__MASCOT_ANIMS && window.__MASCOT_ANIMS[key];
  }

  function showState(key) {
    var data = getAnimData(key);
    if (!data) return;
    if (currentState === key) return;

    // Clear any pending hide timer
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    currentState = key;
    stage.style.display = "flex";

    // Destroy previous animation to prevent overlapping SVGs / memory leaks
    if (currentAnim) {
      currentAnim.destroy();
      currentAnim = null;
    }
    container.innerHTML = "";

    var isComplete = (key === "complete");

    currentAnim = lottie.loadAnimation({
      container: container,
      renderer: "svg",
      loop: !isComplete,   // thinking & needsInput loop; complete plays once
      autoplay: true,
      animationData: data
    });

    // Complete: after animation finishes, wait 1s then hide
    if (isComplete) {
      currentAnim.addEventListener("complete", function onDone() {
        currentAnim.removeEventListener("complete", onDone);
        hideTimer = setTimeout(hideState, 1000);
      });
    }

    // Update label text
    var info = labels[key];
    if (info && labelEl) {
      labelEl.textContent = info.text;
      labelEl.style.background = info.color + "22";
      labelEl.style.color = info.color;
      labelEl.style.display = "";
    }
  }

  function hideState() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (!currentState) return;

    if (currentAnim) {
      currentAnim.destroy();
      currentAnim = null;
    }

    container.innerHTML = "";
    stage.style.display = "none";
    currentState = null;

    if (labelEl) {
      labelEl.textContent = "";
      labelEl.style.display = "none";
    }
  }

  // ── Message listener ──
  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (msg.type === "vibeState") {
      var key = mapState(msg.state);
      if (key) {
        showState(key);
      } else {
        hideState();
      }
    }
    if (msg.type === "mascotConfig" && !msg.enabled) hideState();
  });
})();

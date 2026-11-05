(() => {
  // node_modules/@simplewebauthn/browser/esm/helpers/bufferToBase64URLString.js
  function bufferToBase64URLString(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = "";
    for (const charCode of bytes) {
      str += String.fromCharCode(charCode);
    }
    const base64String = btoa(str);
    return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  // node_modules/@simplewebauthn/browser/esm/helpers/base64URLStringToBuffer.js
  function base64URLStringToBuffer(base64URLString) {
    const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - base64.length % 4) % 4;
    const padded = base64.padEnd(base64.length + padLength, "=");
    const binary = atob(padded);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return buffer;
  }

  // node_modules/@simplewebauthn/browser/esm/helpers/browserSupportsWebAuthn.js
  function browserSupportsWebAuthn() {
    return _browserSupportsWebAuthnInternals.stubThis(globalThis?.PublicKeyCredential !== void 0 && typeof globalThis.PublicKeyCredential === "function");
  }
  var _browserSupportsWebAuthnInternals = {
    stubThis: (value) => value
  };

  // node_modules/@simplewebauthn/browser/esm/helpers/toPublicKeyCredentialDescriptor.js
  function toPublicKeyCredentialDescriptor(descriptor) {
    const { id } = descriptor;
    return {
      ...descriptor,
      id: base64URLStringToBuffer(id),
      transports: descriptor.transports,
      type: descriptor.type
    };
  }

  // node_modules/@simplewebauthn/browser/esm/helpers/isValidDomain.js
  function isValidDomain(hostname) {
    return (
      // Consider localhost valid as well since it's okay wrt Secure Contexts
      hostname === "localhost" || // Support punycode (ACE) or ascii labels and domains
      /^((xn--[a-z0-9-]+|[a-z0-9]+(-[a-z0-9]+)*)\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(hostname)
    );
  }

  // node_modules/@simplewebauthn/browser/esm/helpers/webAuthnError.js
  var WebAuthnError = class extends Error {
    constructor({ message, code, cause, name }) {
      super(message, { cause });
      Object.defineProperty(this, "code", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      this.name = name ?? cause.name;
      this.code = code;
    }
  };

  // node_modules/@simplewebauthn/browser/esm/helpers/identifyRegistrationError.js
  function identifyRegistrationError({ error, options }) {
    const { publicKey } = options;
    if (!publicKey) {
      throw Error("options was missing required publicKey property");
    }
    if (error.name === "AbortError") {
      if (options.signal instanceof AbortSignal) {
        return new WebAuthnError({
          message: "Registration ceremony was sent an abort signal",
          code: "ERROR_CEREMONY_ABORTED",
          cause: error
        });
      }
    } else if (error.name === "ConstraintError") {
      if (publicKey.authenticatorSelection?.requireResidentKey === true) {
        return new WebAuthnError({
          message: "Discoverable credentials were required but no available authenticator supported it",
          code: "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
          cause: error
        });
      } else if (
        // @ts-ignore: `mediation` doesn't yet exist on CredentialCreationOptions but it's possible as of Sept 2024
        options.mediation === "conditional" && publicKey.authenticatorSelection?.userVerification === "required"
      ) {
        return new WebAuthnError({
          message: "User verification was required during automatic registration but it could not be performed",
          code: "ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE",
          cause: error
        });
      } else if (publicKey.authenticatorSelection?.userVerification === "required") {
        return new WebAuthnError({
          message: "User verification was required but no available authenticator supported it",
          code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
          cause: error
        });
      }
    } else if (error.name === "InvalidStateError") {
      return new WebAuthnError({
        message: "The authenticator was previously registered",
        code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
        cause: error
      });
    } else if (error.name === "NotAllowedError") {
      return new WebAuthnError({
        message: error.message,
        code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
        cause: error
      });
    } else if (error.name === "NotSupportedError") {
      const validPubKeyCredParams = publicKey.pubKeyCredParams.filter((param) => param.type === "public-key");
      if (validPubKeyCredParams.length === 0) {
        return new WebAuthnError({
          message: 'No entry in pubKeyCredParams was of type "public-key"',
          code: "ERROR_MALFORMED_PUBKEYCREDPARAMS",
          cause: error
        });
      }
      return new WebAuthnError({
        message: "No available authenticator supported any of the specified pubKeyCredParams algorithms",
        code: "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
        cause: error
      });
    } else if (error.name === "SecurityError") {
      const effectiveDomain = globalThis.location.hostname;
      if (!isValidDomain(effectiveDomain)) {
        return new WebAuthnError({
          message: `${globalThis.location.hostname} is an invalid domain`,
          code: "ERROR_INVALID_DOMAIN",
          cause: error
        });
      } else if (publicKey.rp.id !== effectiveDomain) {
        return new WebAuthnError({
          message: `The RP ID "${publicKey.rp.id}" is invalid for this domain`,
          code: "ERROR_INVALID_RP_ID",
          cause: error
        });
      }
    } else if (error.name === "TypeError") {
      if (publicKey.user.id.byteLength < 1 || publicKey.user.id.byteLength > 64) {
        return new WebAuthnError({
          message: "User ID was not between 1 and 64 characters",
          code: "ERROR_INVALID_USER_ID_LENGTH",
          cause: error
        });
      }
    } else if (error.name === "UnknownError") {
      return new WebAuthnError({
        message: "The authenticator was unable to process the specified options, or could not create a new credential",
        code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
        cause: error
      });
    }
    return error;
  }

  // node_modules/@simplewebauthn/browser/esm/helpers/webAuthnAbortService.js
  var BaseWebAuthnAbortService = class {
    constructor() {
      Object.defineProperty(this, "controller", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
    }
    createNewAbortSignal() {
      if (this.controller) {
        const abortError = new Error("Cancelling existing WebAuthn API call for new one");
        abortError.name = "AbortError";
        this.controller.abort(abortError);
      }
      const newController = new AbortController();
      this.controller = newController;
      return newController.signal;
    }
    cancelCeremony() {
      if (this.controller) {
        const abortError = new Error("Manually cancelling existing WebAuthn API call");
        abortError.name = "AbortError";
        this.controller.abort(abortError);
        this.controller = void 0;
      }
    }
  };
  var WebAuthnAbortService = new BaseWebAuthnAbortService();

  // node_modules/@simplewebauthn/browser/esm/helpers/toAuthenticatorAttachment.js
  var attachments = ["cross-platform", "platform"];
  function toAuthenticatorAttachment(attachment) {
    if (!attachment) {
      return;
    }
    if (attachments.indexOf(attachment) < 0) {
      return;
    }
    return attachment;
  }

  // node_modules/@simplewebauthn/browser/esm/methods/startRegistration.js
  async function startRegistration(options) {
    if (!options.optionsJSON && options.challenge) {
      console.warn("startRegistration() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
      options = { optionsJSON: options };
    }
    const { optionsJSON, useAutoRegister = false } = options;
    if (!browserSupportsWebAuthn()) {
      throw new Error("WebAuthn is not supported in this browser");
    }
    const publicKey = {
      ...optionsJSON,
      challenge: base64URLStringToBuffer(optionsJSON.challenge),
      user: {
        ...optionsJSON.user,
        id: base64URLStringToBuffer(optionsJSON.user.id)
      },
      excludeCredentials: optionsJSON.excludeCredentials?.map(toPublicKeyCredentialDescriptor)
    };
    const createOptions = {};
    if (useAutoRegister) {
      createOptions.mediation = "conditional";
    }
    createOptions.publicKey = publicKey;
    createOptions.signal = WebAuthnAbortService.createNewAbortSignal();
    let credential;
    try {
      credential = await navigator.credentials.create(
        // TODO: Newer versions of Deno require this casting, revisit once we're using Deno 2.6+
        createOptions
      );
    } catch (err) {
      throw identifyRegistrationError({ error: err, options: createOptions });
    }
    if (!credential) {
      throw new Error("Registration was not completed");
    }
    const { id, rawId, response, type } = credential;
    let transports = void 0;
    if (typeof response.getTransports === "function") {
      transports = response.getTransports();
    }
    let responsePublicKeyAlgorithm = void 0;
    if (typeof response.getPublicKeyAlgorithm === "function") {
      try {
        responsePublicKeyAlgorithm = response.getPublicKeyAlgorithm();
      } catch (error) {
        warnOnBrokenImplementation("getPublicKeyAlgorithm()", error);
      }
    }
    let responsePublicKey = void 0;
    if (typeof response.getPublicKey === "function") {
      try {
        const _publicKey = response.getPublicKey();
        if (_publicKey !== null) {
          responsePublicKey = bufferToBase64URLString(_publicKey);
        }
      } catch (error) {
        warnOnBrokenImplementation("getPublicKey()", error);
      }
    }
    let responseAuthenticatorData;
    if (typeof response.getAuthenticatorData === "function") {
      try {
        responseAuthenticatorData = bufferToBase64URLString(response.getAuthenticatorData());
      } catch (error) {
        warnOnBrokenImplementation("getAuthenticatorData()", error);
      }
    }
    return {
      id,
      rawId: bufferToBase64URLString(rawId),
      response: {
        attestationObject: bufferToBase64URLString(response.attestationObject),
        clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
        transports,
        publicKeyAlgorithm: responsePublicKeyAlgorithm,
        publicKey: responsePublicKey,
        authenticatorData: responseAuthenticatorData
      },
      type,
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: toAuthenticatorAttachment(credential.authenticatorAttachment)
    };
  }
  function warnOnBrokenImplementation(methodName, cause) {
    console.warn(`The browser extension that intercepted this WebAuthn API call incorrectly implemented ${methodName}. You should report this error to them.
`, cause);
  }

  // node_modules/@simplewebauthn/browser/esm/helpers/browserSupportsWebAuthnAutofill.js
  function browserSupportsWebAuthnAutofill() {
    if (!browserSupportsWebAuthn()) {
      return _browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
    }
    const globalPublicKeyCredential = globalThis.PublicKeyCredential;
    if (globalPublicKeyCredential?.isConditionalMediationAvailable === void 0) {
      return _browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
    }
    return _browserSupportsWebAuthnAutofillInternals.stubThis(globalPublicKeyCredential.isConditionalMediationAvailable());
  }
  var _browserSupportsWebAuthnAutofillInternals = {
    stubThis: (value) => value
  };

  // node_modules/@simplewebauthn/browser/esm/helpers/identifyAuthenticationError.js
  function identifyAuthenticationError({ error, options }) {
    const { publicKey } = options;
    if (!publicKey) {
      throw Error("options was missing required publicKey property");
    }
    if (error.name === "AbortError") {
      if (options.signal instanceof AbortSignal) {
        return new WebAuthnError({
          message: "Authentication ceremony was sent an abort signal",
          code: "ERROR_CEREMONY_ABORTED",
          cause: error
        });
      }
    } else if (error.name === "NotAllowedError") {
      return new WebAuthnError({
        message: error.message,
        code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
        cause: error
      });
    } else if (error.name === "SecurityError") {
      const effectiveDomain = globalThis.location.hostname;
      if (!isValidDomain(effectiveDomain)) {
        return new WebAuthnError({
          message: `${globalThis.location.hostname} is an invalid domain`,
          code: "ERROR_INVALID_DOMAIN",
          cause: error
        });
      } else if (publicKey.rpId !== effectiveDomain) {
        return new WebAuthnError({
          message: `The RP ID "${publicKey.rpId}" is invalid for this domain`,
          code: "ERROR_INVALID_RP_ID",
          cause: error
        });
      }
    } else if (error.name === "UnknownError") {
      return new WebAuthnError({
        message: "The authenticator was unable to process the specified options, or could not create a new assertion signature",
        code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
        cause: error
      });
    }
    return error;
  }

  // node_modules/@simplewebauthn/browser/esm/methods/startAuthentication.js
  async function startAuthentication(options) {
    if (!options.optionsJSON && options.challenge) {
      console.warn("startAuthentication() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
      options = { optionsJSON: options };
    }
    const { optionsJSON, useBrowserAutofill = false, verifyBrowserAutofillInput = true } = options;
    if (!browserSupportsWebAuthn()) {
      throw new Error("WebAuthn is not supported in this browser");
    }
    let allowCredentials;
    if (optionsJSON.allowCredentials?.length !== 0) {
      allowCredentials = optionsJSON.allowCredentials?.map(toPublicKeyCredentialDescriptor);
    }
    const publicKey = {
      ...optionsJSON,
      challenge: base64URLStringToBuffer(optionsJSON.challenge),
      allowCredentials
    };
    const getOptions = {};
    if (useBrowserAutofill) {
      if (!await browserSupportsWebAuthnAutofill()) {
        throw Error("Browser does not support WebAuthn autofill");
      }
      const eligibleInputs = document.querySelectorAll("input[autocomplete$='webauthn']");
      if (eligibleInputs.length < 1 && verifyBrowserAutofillInput) {
        throw Error('No <input> with "webauthn" as the only or last value in its `autocomplete` attribute was detected');
      }
      getOptions.mediation = "conditional";
      publicKey.allowCredentials = [];
    }
    getOptions.publicKey = publicKey;
    getOptions.signal = WebAuthnAbortService.createNewAbortSignal();
    let credential;
    try {
      credential = await navigator.credentials.get(
        // TODO: Newer versions of Deno require this casting, revisit once we're using Deno 2.6+
        getOptions
      );
    } catch (err) {
      throw identifyAuthenticationError({ error: err, options: getOptions });
    }
    if (!credential) {
      throw new Error("Authentication was not completed");
    }
    const { id, rawId, response, type } = credential;
    let userHandle = void 0;
    if (response.userHandle) {
      userHandle = bufferToBase64URLString(response.userHandle);
    }
    return {
      id,
      rawId: bufferToBase64URLString(rawId),
      response: {
        authenticatorData: bufferToBase64URLString(response.authenticatorData),
        clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
        signature: bufferToBase64URLString(response.signature),
        userHandle
      },
      type,
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: toAuthenticatorAttachment(credential.authenticatorAttachment)
    };
  }

  // client/i18n.js
  var DICT = {
    "zh-TW": {
      "app.title": "Passkeys 無密碼登入",
      "nav.auth": "登入 / 註冊",
      "nav.account": "我的帳號",
      "nav.debug": "除錯",
      "login.title": "使用 Passkey 登入",
      "login.username": "使用者名稱（可留空）",
      "login.hint": "留空即可「免帳號登入」：瀏覽器會列出此網站的 passkey 供你選擇。支援自動填入（conditional UI）的瀏覽器點輸入框即可看到建議。",
      "login.button": "以 Passkey 登入",
      "reg.title": "建立新帳號",
      "reg.username": "使用者名稱",
      "reg.displayName": "顯示名稱（選填）",
      "reg.hint": "不需要密碼。按下後裝置會要求 Windows Hello / Touch ID / 手機 / 安全金鑰 建立 passkey。",
      "reg.button": "建立 Passkey 並註冊",
      "acct.hello": "你好，",
      "acct.newName": "新 passkey 名稱（選填）",
      "acct.add": "新增 Passkey",
      "acct.logout": "登出",
      "acct.passkeys": "我的 Passkeys",
      "acct.audit": "稽核紀錄",
      "acct.since": "帳號建立於 {0}",
      "audit.time": "時間",
      "audit.event": "事件",
      "audit.result": "結果",
      "audit.detail": "細節",
      "audit.ok": "成功",
      "audit.fail": "失敗",
      "pk.created": "建立",
      "pk.lastUsed": "最後使用",
      "pk.never": "尚未使用",
      "pk.counter": "簽章計數器",
      "pk.transports": "傳輸方式",
      "pk.rename": "重新命名",
      "pk.delete": "刪除",
      "pk.current": "本次登入使用",
      "pk.synced": "已同步備份 (BS)",
      "pk.notSynced": "未備份",
      "pk.be": "可備份 (BE)",
      "pk.singleDevice": "單一裝置",
      "pk.multiDevice": "多裝置（可同步）",
      "pk.renamePrompt": "新的名稱：",
      "pk.deleteConfirm": "確定刪除「{0}」？裝置上的 passkey 不會自動刪除，之後用它登入會失敗。",
      "debug.title": "WebAuthn 原始資料（--debug）",
      "debug.hint": "顯示最近 20 次儀式的 options / response，並解碼 clientDataJSON、authenticatorData 旗標（UP/UV/BE/BS）與 COSE 公鑰。僅供學習，正式環境請勿啟用 --debug。",
      "debug.refresh": "重新整理",
      "debug.empty": "尚無資料。先註冊或登入一次。",
      "ok.registered": "註冊成功！已建立 passkey「{0}」並登入。",
      "ok.login": "登入成功，歡迎 {0}。",
      "ok.added": "已新增 passkey「{0}」。",
      "ok.deleted": "已刪除 passkey。",
      "ok.renamed": "已重新命名。",
      "ok.logout": "已登出。",
      "busy": "請依照裝置提示操作…",
      "err.NotAllowedError": "操作已取消或逾時（NotAllowedError）。請再試一次；若沒看到提示，確認裝置已設定 Windows Hello / 螢幕鎖定，或此網站沒有可用的 passkey。",
      "err.InvalidStateError": "這個驗證器已經註冊過此帳號的 passkey（InvalidStateError）。請改用其他裝置／安全金鑰，或直接用它登入。",
      "err.SecurityError": "安全性錯誤（SecurityError）：目前網址 {0} 與伺服器設定的 rpID 不相符，或不是安全環境（需 https 或 localhost）。請改用 {1} 開啟。",
      "err.NotSupportedError": "此瀏覽器或驗證器不支援要求的演算法或選項（NotSupportedError）。",
      "err.ConstraintError": "驗證器無法滿足需求（例如不支援使用者驗證或可探索憑證）（ConstraintError）。",
      "err.UnknownError": "驗證器發生未知錯誤（UnknownError）。",
      "err.unsupported": "此瀏覽器不支援 WebAuthn / passkey。請使用新版 Chrome、Edge、Safari 或 Firefox。",
      "err.USERNAME_TAKEN": "此使用者名稱已註冊。請改用 Passkey 登入，或換一個名稱。",
      "err.USERNAME_INVALID": "使用者名稱需為 3–32 個字元：英數字與 . _ @ -",
      "err.CHALLENGE_MISSING": "找不到進行中的挑戰值（可能已使用過或 Cookie 被阻擋）。請重試。",
      "err.CHALLENGE_EXPIRED": "挑戰值已逾時（5 分鐘）。請重試。",
      "err.CHALLENGE_MISMATCH": "挑戰值不符，請重試。",
      "err.ORIGIN_MISMATCH": "來源（origin）不符：{0}",
      "err.RPID_MISMATCH": "RP ID 不符：{0}",
      "err.CREDENTIAL_NOT_FOUND": "伺服器找不到這個 passkey（可能已在帳號頁刪除）。請刪除裝置上的這個 passkey，或改用其他 passkey 登入。",
      "err.CREDENTIAL_EXISTS": "此 passkey 已註冊過。",
      "err.COUNTER_REGRESSION": "簽章計數器沒有增加，疑似驗證器被複製，已拒絕登入。",
      "err.USER_MISMATCH": "passkey 與使用者不符。",
      "err.UV_REQUIRED": "伺服器要求使用者驗證（PIN / 生物辨識），但驗證器未提供。",
      "err.LAST_PASSKEY": "不能刪除唯一的 passkey，否則將無法再登入。請先新增另一把。",
      "err.NOT_AUTHENTICATED": "請先登入。",
      "err.NOT_FOUND": "找不到資料。",
      "err.VERIFY_FAILED": "驗證失敗：{0}",
      "err.network": "無法連線到伺服器：{0}",
      "err.generic": "發生錯誤：{0}",
      "warn.insecure": "目前不是安全環境（{0}）。WebAuthn 只能在 https:// 或 http://localhost 使用。",
      "warn.host": "目前網址 {0} 與伺服器設定的來源 {1} 不同，passkey 操作會失敗。請改用 {1} 開啟。",
      "footer": "RP ID：{0} ・ 來源：{1}{2}"
    },
    en: {
      "app.title": "Passkeys passwordless login",
      "nav.auth": "Sign in / Register",
      "nav.account": "My account",
      "nav.debug": "Debug",
      "login.title": "Sign in with a passkey",
      "login.username": "Username (optional)",
      "login.hint": "Leave empty for usernameless sign-in: the browser lists the passkeys it has for this site. Browsers with autofill (conditional UI) show suggestions when you focus the field.",
      "login.button": "Sign in with passkey",
      "reg.title": "Create an account",
      "reg.username": "Username",
      "reg.displayName": "Display name (optional)",
      "reg.hint": "No password. Your device will ask Windows Hello / Touch ID / phone / security key to create a passkey.",
      "reg.button": "Create passkey and register",
      "acct.hello": "Hello, ",
      "acct.newName": "New passkey name (optional)",
      "acct.add": "Add passkey",
      "acct.logout": "Sign out",
      "acct.passkeys": "My passkeys",
      "acct.audit": "Audit log",
      "acct.since": "Account created {0}",
      "audit.time": "Time",
      "audit.event": "Event",
      "audit.result": "Result",
      "audit.detail": "Detail",
      "audit.ok": "OK",
      "audit.fail": "FAILED",
      "pk.created": "Created",
      "pk.lastUsed": "Last used",
      "pk.never": "never",
      "pk.counter": "Sign counter",
      "pk.transports": "Transports",
      "pk.rename": "Rename",
      "pk.delete": "Delete",
      "pk.current": "Used for this session",
      "pk.synced": "Backed up (BS)",
      "pk.notSynced": "Not backed up",
      "pk.be": "Backup eligible (BE)",
      "pk.singleDevice": "Single-device",
      "pk.multiDevice": "Multi-device (syncable)",
      "pk.renamePrompt": "New name:",
      "pk.deleteConfirm": 'Delete "{0}"? The passkey stays on your device; signing in with it will fail afterwards.',
      "debug.title": "Raw WebAuthn data (--debug)",
      "debug.hint": "Last 20 ceremonies: options / responses with decoded clientDataJSON, authenticatorData flags (UP/UV/BE/BS) and the COSE public key. For learning only; never run production with --debug.",
      "debug.refresh": "Refresh",
      "debug.empty": "Nothing yet. Register or sign in first.",
      "ok.registered": 'Registered! Passkey "{0}" created and you are signed in.',
      "ok.login": "Signed in. Welcome, {0}.",
      "ok.added": 'Passkey "{0}" added.',
      "ok.deleted": "Passkey deleted.",
      "ok.renamed": "Renamed.",
      "ok.logout": "Signed out.",
      "busy": "Follow the prompt on your device...",
      "err.NotAllowedError": "The operation was cancelled or timed out (NotAllowedError). Try again; if no prompt appeared, check that Windows Hello / a screen lock is set up, or that a passkey exists for this site.",
      "err.InvalidStateError": "This authenticator already holds a passkey for this account (InvalidStateError). Use another device / security key, or just sign in with it.",
      "err.SecurityError": "SecurityError: this URL ({0}) does not match the server rpID, or the page is not a secure context (https or localhost needed). Open {1} instead.",
      "err.NotSupportedError": "The browser or authenticator does not support the requested algorithm or options (NotSupportedError).",
      "err.ConstraintError": "The authenticator cannot satisfy the requirements (e.g. user verification or discoverable credentials) (ConstraintError).",
      "err.UnknownError": "The authenticator reported an unknown error (UnknownError).",
      "err.unsupported": "This browser does not support WebAuthn / passkeys. Use a current Chrome, Edge, Safari or Firefox.",
      "err.USERNAME_TAKEN": "That username is already registered. Sign in with your passkey or pick another name.",
      "err.USERNAME_INVALID": "Username must be 3-32 characters: letters, digits, . _ @ -",
      "err.CHALLENGE_MISSING": "No pending challenge (already used, or cookies blocked). Please retry.",
      "err.CHALLENGE_EXPIRED": "The challenge expired (5 minutes). Please retry.",
      "err.CHALLENGE_MISMATCH": "Challenge mismatch, please retry.",
      "err.ORIGIN_MISMATCH": "Origin mismatch: {0}",
      "err.RPID_MISMATCH": "RP ID mismatch: {0}",
      "err.CREDENTIAL_NOT_FOUND": "The server does not know this passkey (it may have been deleted on the account page). Remove it from your device or use another passkey.",
      "err.CREDENTIAL_EXISTS": "This passkey is already registered.",
      "err.COUNTER_REGRESSION": "The signature counter did not increase - possible cloned authenticator. Sign-in rejected.",
      "err.USER_MISMATCH": "The passkey does not belong to that user.",
      "err.UV_REQUIRED": "The server requires user verification (PIN / biometrics) but the authenticator did not provide it.",
      "err.LAST_PASSKEY": "You cannot delete your only passkey (you would be locked out). Add another one first.",
      "err.NOT_AUTHENTICATED": "Please sign in first.",
      "err.NOT_FOUND": "Not found.",
      "err.VERIFY_FAILED": "Verification failed: {0}",
      "err.network": "Cannot reach the server: {0}",
      "err.generic": "Error: {0}",
      "warn.insecure": "This page is not a secure context ({0}). WebAuthn only works on https:// or http://localhost.",
      "warn.host": "This URL ({0}) differs from the configured origin {1}; passkey operations will fail. Open {1} instead.",
      "footer": "RP ID: {0} · Origin: {1}{2}"
    }
  };

  // client/main.js
  var $ = (sel) => document.querySelector(sel);
  var store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
      }
    }
  };
  var lang = store.get("pk.lang") || "zh-TW";
  var config = null;
  var me = null;
  function t(key, ...args) {
    const s = DICT[lang][key] ?? DICT["zh-TW"][key] ?? key;
    return s.replace(/\{(\d)\}/g, (_, i) => args[i] ?? "");
  }
  function applyI18n() {
    document.documentElement.lang = lang === "en" ? "en" : "zh-Hant";
    document.querySelectorAll("[data-i18n]").forEach((el2) => {
      el2.textContent = t(el2.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el2) => {
      el2.placeholder = t(el2.dataset.i18nPlaceholder);
    });
    $("#langBtn").textContent = lang === "en" ? "中文" : "EN";
    document.title = t("app.title");
    if (config) $("#rpInfo").textContent = t("footer", config.rpID, config.origins.join(", "), config.debug ? " · --debug" : "");
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("#themeBtn").textContent = theme === "dark" ? "☀" : "☾";
    store.set("pk.theme", theme);
  }
  var msgTimer;
  function showMsg(kind, text) {
    const el2 = $("#msg");
    el2.className = `msg ${kind}`;
    el2.textContent = text;
    el2.hidden = false;
    el2.dataset.kind = kind;
    clearTimeout(msgTimer);
    if (kind === "ok") msgTimer = setTimeout(() => {
      el2.hidden = true;
    }, 6e3);
  }
  var clearMsg = () => {
    $("#msg").hidden = true;
  };
  var ApiError = class extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  };
  async function api(path, { method = "GET", body } = {}) {
    let res;
    try {
      res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : void 0, credentials: "same-origin" });
    } catch (err) {
      throw new ApiError("network", err.message, 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error?.code || "generic", data.error?.message || res.statusText, res.status);
    return data;
  }
  function friendlyError(err) {
    if (err instanceof ApiError) {
      const key = `err.${err.code}`;
      return DICT[lang][key] ? t(key, err.message) : t("err.generic", err.message);
    }
    const name = err?.name || "";
    if (name === "SecurityError") return t("err.SecurityError", location.origin, config?.origins?.[0] ?? "");
    if (DICT[lang][`err.${name}`]) return t(`err.${name}`);
    return t("err.generic", err?.message || String(err));
  }
  var isAbort = (err) => err?.name === "AbortError" || err?.code === "ERROR_CEREMONY_ABORTED";
  async function withBusy(btn, fn) {
    btn.disabled = true;
    showMsg("warn", t("busy"));
    try {
      await fn();
    } catch (err) {
      if (isAbort(err)) {
        clearMsg();
        return;
      }
      console.warn("[passkeys]", err.name || err.code, err.message);
      showMsg("error", friendlyError(err));
    } finally {
      btn.disabled = false;
    }
  }
  async function register(username, displayName, name) {
    const optionsJSON = await api("/api/register/options", { method: "POST", body: { username, displayName } });
    const response = await startRegistration({ optionsJSON });
    return api("/api/register/verify", { method: "POST", body: { response, name } });
  }
  async function login(username, { autofill = false } = {}) {
    const optionsJSON = await api("/api/login/options", { method: "POST", body: { username: username || void 0 } });
    const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
    return api("/api/login/verify", { method: "POST", body: { response } });
  }
  async function startConditionalUI() {
    if (new URLSearchParams(location.search).get("autofill") === "0") return;
    if (!await browserSupportsWebAuthnAutofill()) return;
    try {
      const r = await login(void 0, { autofill: true });
      await afterLogin(r);
    } catch (err) {
      if (!isAbort(err)) showMsg("error", friendlyError(err));
    }
  }
  async function afterLogin(r) {
    await refreshMe();
    showMsg("ok", t("ok.login", r.user.displayName || r.user.username));
    await navigate("/account");
  }
  async function refreshMe() {
    me = (await api("/api/me")).user;
    document.querySelector('[data-view="account"]').hidden = !me;
    document.querySelector('[data-view="debug"]').hidden = !config?.debug;
  }
  function fmtDate(s) {
    return s ? new Date(s).toLocaleString(lang === "en" ? "en-US" : "zh-TW", { hour12: false }) : t("pk.never");
  }
  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) e.append(c);
    return e;
  }
  async function renderAccount() {
    if (!me) return navigate("/");
    $("#who").textContent = me.displayName || me.username;
    $("#whoMeta").textContent = `@${me.username} · ${t("acct.since", fmtDate(me.createdAt))}`;
    const { passkeys, currentCredentialId } = await api("/api/passkeys");
    const list = $("#pkList");
    list.replaceChildren(...passkeys.map((pk) => el(
      "li",
      { class: "pk", "data-id": pk.id },
      el("div", { class: "name" }, pk.name),
      el(
        "div",
        { class: "badges" },
        pk.id === currentCredentialId ? el("span", { class: "badge cur" }, t("pk.current")) : null,
        el("span", { class: "badge" }, pk.deviceType === "multiDevice" ? t("pk.multiDevice") : t("pk.singleDevice")),
        pk.backupEligible ? el("span", { class: "badge" }, t("pk.be")) : null,
        el("span", { class: "badge" }, pk.backedUp ? t("pk.synced") : t("pk.notSynced"))
      ),
      el("div", { class: "meta" }, `${pk.authenticator} · AAGUID ${pk.aaguid || "-"}`),
      el("div", { class: "meta" }, `${t("pk.created")}: ${fmtDate(pk.createdAt)} · ${t("pk.lastUsed")}: ${fmtDate(pk.lastUsedAt)}`),
      el("div", { class: "meta" }, `${t("pk.counter")}: `, el("span", { class: "counter" }, String(pk.counter)), ` · ${t("pk.transports")}: ${pk.transports.join(", ") || "-"} · ID ${pk.id.slice(0, 16)}...`),
      el(
        "div",
        { class: "row" },
        el("button", { type: "button", class: "ghost", onclick: () => renamePk(pk) }, t("pk.rename")),
        el("button", { type: "button", class: "danger", onclick: () => deletePk(pk) }, t("pk.delete"))
      )
    )));
    const { events } = await api("/api/audit?limit=30");
    $("#auditTable tbody").replaceChildren(...events.map((e) => el(
      "tr",
      {},
      el("td", {}, fmtDate(e.ts)),
      el("td", {}, e.event),
      el("td", { class: e.ok ? "pass" : "fail" }, e.ok ? t("audit.ok") : t("audit.fail")),
      el("td", {}, [e.detail, e.credentialId ? `cred ${e.credentialId.slice(0, 10)}...` : null].filter(Boolean).join(" · "))
    )));
  }
  async function renamePk(pk) {
    const name = prompt(t("pk.renamePrompt"), pk.name);
    if (!name) return;
    try {
      await api(`/api/passkeys/${pk.id}`, { method: "PATCH", body: { name } });
      showMsg("ok", t("ok.renamed"));
      await renderAccount();
    } catch (err) {
      showMsg("error", friendlyError(err));
    }
  }
  async function deletePk(pk) {
    if (!confirm(t("pk.deleteConfirm", pk.name))) return;
    try {
      await api(`/api/passkeys/${pk.id}`, { method: "DELETE" });
      showMsg("ok", t("ok.deleted"));
      await renderAccount();
    } catch (err) {
      showMsg("error", friendlyError(err));
    }
  }
  async function renderDebug() {
    const box = $("#debugList");
    const { ceremonies } = await api("/api/debug/ceremonies");
    if (!ceremonies.length) {
      box.replaceChildren(el("p", { class: "hint" }, t("debug.empty")));
      return;
    }
    box.replaceChildren(...ceremonies.map((c, i) => el(
      "details",
      i < 2 ? { open: "" } : {},
      el("summary", {}, `${c.at} · ${c.kind}${c.ok === false ? " · FAILED: " + c.error : ""}`),
      c.decoded ? el("div", {}, el("h3", {}, "decoded"), el("pre", {}, JSON.stringify(c.decoded, null, 2))) : null,
      el("h3", {}, c.options ? "options (server -> browser)" : "response (browser -> server)"),
      el("pre", {}, JSON.stringify(c.options || c.response, null, 2))
    )));
  }
  function currentView() {
    const p = location.pathname;
    if (p === "/account") return "account";
    if (p === "/debug") return "debug";
    return "auth";
  }
  async function render() {
    const view = currentView();
    document.querySelectorAll(".view").forEach((s) => {
      s.hidden = s.id !== `view-${view}`;
    });
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
    try {
      if (view === "account") await renderAccount();
      else if (view === "debug") {
        if (!config?.debug) return navigate("/");
        await renderDebug();
      } else if (view === "auth") {
        if (me) return navigate("/account");
        startConditionalUI();
      }
    } catch (err) {
      showMsg("error", friendlyError(err));
    }
  }
  async function navigate(path) {
    if (location.pathname !== path) history.pushState({}, "", path + location.search);
    if (currentView() !== "auth") WebAuthnAbortService.cancelCeremony();
    await render();
  }
  function checkEnvironment() {
    const warn = $("#envWarn");
    const msgs = [];
    if (!window.isSecureContext) msgs.push(t("warn.insecure", location.origin));
    else if (config && !config.origins.includes(location.origin)) msgs.push(t("warn.host", location.origin, config.origins[0]));
    if (!browserSupportsWebAuthn()) msgs.push(t("err.unsupported"));
    warn.textContent = msgs.join("\n");
    warn.hidden = !msgs.length;
  }
  async function init() {
    const theme = store.get("pk.theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    applyTheme(theme);
    applyI18n();
    $("#langBtn").addEventListener("click", () => {
      lang = lang === "en" ? "zh-TW" : "en";
      store.set("pk.lang", lang);
      applyI18n();
      if (currentView() === "account") renderAccount().catch(() => {
      });
    });
    $("#themeBtn").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    document.querySelectorAll("#nav a").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      clearMsg();
      navigate(a.getAttribute("href"));
    }));
    window.addEventListener("popstate", render);
    $("#loginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      withBusy($("#loginBtn"), async () => afterLogin(await login($("#loginUser").value.trim())));
    });
    $("#registerForm").addEventListener("submit", (e) => {
      e.preventDefault();
      withBusy($("#registerBtn"), async () => {
        const r = await register($("#regUser").value.trim(), $("#regName").value.trim());
        await refreshMe();
        showMsg("ok", t("ok.registered", r.passkey.name));
        await navigate("/account");
      });
    });
    $("#addPkBtn").addEventListener("click", () => withBusy($("#addPkBtn"), async () => {
      const r = await register(void 0, void 0, $("#newPkName").value.trim());
      $("#newPkName").value = "";
      showMsg("ok", t("ok.added", r.passkey.name));
      await renderAccount();
    }));
    $("#logoutBtn").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST", body: {} });
      me = null;
      await refreshMe();
      showMsg("ok", t("ok.logout"));
      await navigate("/");
    });
    $("#debugRefresh").addEventListener("click", () => renderDebug().catch((err) => showMsg("error", friendlyError(err))));
    try {
      config = await api("/api/config");
      applyI18n();
      checkEnvironment();
      await refreshMe();
    } catch (err) {
      showMsg("error", friendlyError(err));
    }
    await render();
    document.body.dataset.ready = "1";
  }
  init();
})();
//# sourceMappingURL=app.js.map

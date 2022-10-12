(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.MesonTo = factory());
})(this, (function () { 'use strict';

  function addMessageListener (window, target, targetOrigin, onHeight, closer) {
    const listener = evt => {
      if (evt.data.target === 'metamask-inpage') {
        const { data } = evt.data.data;
        if (['metamask_chainChanged', 'metamask_accountsChanged'].includes(data.method)) {
          target.postMessage({ source: 'app', data }, targetOrigin);
        }
        return
      }

      if (evt.origin !== targetOrigin) {
        return
      }
      const { source, data } = evt.data;
      if (source !== 'meson.to') {
        return
      }

      if (data.jsonrpc === '2.0') {
        if (data.method === 'get_global') {
          const value = window[data.params[0]];
          let result;
          if (['string', 'number'].includes(typeof value)) {
            result = value;
          } else if (typeof value === 'object') {
            result = cloneObject(value);
          }
          target.postMessage({
            source: 'app',
            data: { jsonrpc: '2.0', id: data.id, result }
          }, targetOrigin);
          return
        } else if (data.method === 'trx_sign') {
          window.tronWeb?.trx.sign(...data.params)
            .then(result => {
              target.postMessage({
                source: 'app',
                data: { jsonrpc: '2.0', id: data.id, result }
              }, targetOrigin);
            })
            .catch(error => {
              target.postMessage({
                source: 'app',
                data: { jsonrpc: '2.0', id: data.id, error }
              }, targetOrigin);
            });
          return
        }

        window.ethereum.request({ method: data.method, params: data.params })
          .then(result => {
            target.postMessage({
              source: 'app',
              data: { jsonrpc: '2.0', id: data.id, result }
            }, targetOrigin);
          })
          .catch(error => {
            target.postMessage({
              source: 'app',
              data: { jsonrpc: '2.0', id: data.id, error }
            }, targetOrigin);
          });
        return
      }

      if (data.copy) {
        window.navigator.clipboard.writeText(data.copy);
      } else if (data.height && onHeight) {
        onHeight(data.height);
      } else if (closer) {
        if (data.close) {
          dispose();
          closer.block(false);
          closer.close();
        } else if (typeof data.blockClose === 'boolean') {
          closer.block(data.blockClose);
        }
      }
    };

    window.addEventListener('message', listener);
    const dispose = () => window.removeEventListener('message', listener);

    return { dispose }
  }

  function cloneObject (obj, level = 3) {
    if (!obj || !level) {
      return
    }
    return Object.fromEntries(Object.keys(obj)
      .filter(key => !key.startsWith('_') && typeof obj[key] !== 'function')
      .map(key => [
        key,
        typeof obj[key] === 'object' ? cloneObject(obj[key], level - 1) : obj[key]
      ])
    )
  }

  function isMobile (window) {
    const platform = window.navigator.userAgentData?.platform || window.navigator.platform || 'unknown';
    return /(iPhone|iPad|iPod|Linux arm|Linux aar|Android)/.test(platform)
  }

  class MesonTo {
    constructor (window, isTestnet = false) {
      Object.defineProperty(this, 'window', {
        value: window,
        writable: false
      });
      this.mesonToHost = isTestnet ? 'https://testnet.meson.to' : 'https://meson.to';
      this._promise = null;
    }

    async open (appId, type) {
      if (!type) {
        type = isMobile(this.window) ? 'iframe' : 'popup';
      }
      if (type === 'iframe') {
        return this._openIframe(appId)
      } else if (type === 'popup') {
        return this._openPopup(appId)
      } else {
        throw new Error(`Unknown open type: ${type}`)
      }
    }

    _openPopup (appId) {
      if (this._promise) {
        if (this._promise.focus) {
          this._promise.focus();
        }
        return this._promise
      }

      const popup = this.window.open(`${this.mesonToHost}/${appId}`, 'meson.to', 'width=360,height=640');
      const { dispose } = addMessageListener(this.window, popup, this.mesonToHost);

      this._promise = new Promise(resolve => {
        const h = setInterval(() => {
          if (popup.closed) {
            dispose();
            clearInterval(h);
            this._promise = null;
            resolve();
          }
        }, 500);
      });
      this._promise.focus = () => popup.focus();

      return this._promise
    }

    _openIframe (appId) {
      if (this._promise) {
        return this._promise
      }

      const doc = this.window.document;
      const lgScreen = this.window.innerWidth > 440;

      const modal = doc.createElement('div');
      modal.style = 'position:fixed;inset:0;z-index:99999;overflow:hidden;display:flex;flex-direction:column;';
      modal.style['justify-content'] = lgScreen ? 'center' : 'end';

      const backdrop = doc.createElement('div');
      backdrop.style = 'position:fixed;inset:0;transition:background 0.4s;';
      backdrop.ontouchmove = evt => evt.preventDefault();

      const container = doc.createElement('div');
      container.style = 'z-index:10;display:flex;flex-direction:column;align-items:center;';
      container.ontouchmove = evt => evt.preventDefault();

      if (lgScreen) {
        container.style.padding = '24px 0';
        container.style['max-height'] = '100%';
        container.style['overflow-y'] = 'auto';
      } else {
        container.style['padding-top'] = '20px';
        container.style.transform = 'translateY(900px)';
        container.style.transition = 'transform 0.4s';
        container.onclick = evt => evt.stopPropagation();
      }

      const content = doc.createElement('div');
      content.style = 'position:relative;width:100%;max-width:440px;flex-shrink:0;background:#ecf5f0;overflow:hidden;box-shadow:0 0px 24px 0px rgb(0 0 0 / 40%)';

      let barWrapper;
      if (lgScreen) {
        content.style['border-radius'] = '20px';
        content.style.opacity = '0';
        content.style.transition = 'opacity 0.25s';
        const close = doc.createElement('div');
        close.style = 'position:absolute;top:12px;right:16px;height:24px;font-size:28px;line-height:24px;cursor:pointer;color:#0004;';
        close.onmouseover = () => { close.style.color = '#000a'; };
        close.onmouseout = () => { close.style.color = '#0004'; };
        close.innerHTML = '×';
        content.appendChild(close);
      } else {
        content.style['border-radius'] = '20px 20px 0 0';
        content.style['padding-bottom'] = '200px';
        barWrapper = doc.createElement('div');
        barWrapper.style = 'z-index:100;position:absolute;top:10px;left:calc(50% - 50px);cursor:pointer;';
        barWrapper.style.transform = 'translateZ(10px)';
        const bar = doc.createElement('div');
        bar.style = 'background:#000;height:4px;width:60px;border-radius:2px;margin:20px;overflow:hidden;';
        container.appendChild(barWrapper);
        barWrapper.appendChild(bar);
      }

      const iframe = doc.createElement('iframe');
      iframe.style = 'z-index:50;width:100%;max-height:518px;overflow:hidden;border:none;transition:max-height 0.2s;';
      iframe.src = `${this.mesonToHost}/${appId}`;
      if (lgScreen) {
        iframe.style.height = 'calc(100vh - 48px)';
        iframe.style['margin-top'] = '-8px';
      } else {
        iframe.style.height = 'calc(100vh - 80px)';
        iframe.style.transform = 'translateY(1000px)';
        iframe.onload = () => {
          iframe.onload = undefined;
          setTimeout(() => {
            iframe.style.transform = '';
          }, 100);
        };
      }
      const onHeight = height => {
        iframe.style['max-height'] = height + 'px';
      };

      modal.appendChild(backdrop);
      modal.appendChild(container);
      container.appendChild(content);
      content.appendChild(iframe);

      const self = this;
      this._promise = new Promise(resolve => {
        if (barWrapper) {
          let delta = 0;
          barWrapper.ontouchstart = evt => {
            evt.preventDefault();
            const initY = evt.touches[0].clientY;
            container.style.transition = 'none';

            const mask = doc.createElement('div');
            mask.style = 'position:absolute;inset:0;z-index:100;';
            mask.onclick = evt => evt.stopPropagation();
            barWrapper.ontouchend = evt => {
              if (delta < 100) {
                container.style.transition = 'transform 0.4s';
                container.style.transform = 'translateY(200px)';
              } else {
                container.style.transition = 'transform 0.2s';
                container.style['transition-timing-function'] = 'linear';
                closer.close();
                setTimeout(() => {
                  container.style['transition-timing-function'] = 'ease';
                  container.style.transition = 'transform 0.4s';
                }, 200);
              }
              evt.preventDefault();
              modal.removeChild(mask);
              barWrapper.ontouchmove = null;
              barWrapper.ontouchend = null;
            };
            barWrapper.ontouchmove = evt => {
              evt.preventDefault();
              delta = evt.touches[0].clientY - initY;
              if (delta < -100) {
                delta = -100;
              }
              container.style.transform = `translateY(${200 + delta}px)`;
            };
            modal.appendChild(mask);
          };
        }

        const closer = {
          blocked: false,
          block (blocked = true) {
            this.blocked = blocked;
          },
          close () {
            if (this.blocked) {
              iframe.contentWindow.postMessage({ source: 'app', data: { closeBlocked: true } }, self.mesonToHost);
              container.style.transform = 'translateY(200px)';
              return
            }
            if (lgScreen) {
              content.style.opacity = '0';
            } else {
              container.style.transform = 'translateY(900px)';
            }
            backdrop.style.background = 'transparent';
            setTimeout(() => {
              doc.body.removeChild(modal);
            }, 400);
            self._promise = null;

            dispose();
            resolve();
          }
        };

        doc.body.appendChild(modal);
        modal.onclick = () => closer.close();

        const { dispose } = addMessageListener(this.window, iframe.contentWindow, this.mesonToHost, onHeight, closer);

        setTimeout(() => {
          backdrop.style.background = '#000b';
          if (lgScreen) {
            content.style.opacity = '1';
          } else {
            container.style.transform = 'translateY(200px)';
          }
        }, 0);
      });

      return this._promise
    }

    onCompleted (callback) {
      if (this._callback) {
        throw new Error('meson2.onCompleted listener already registered')
      } else if (typeof callback !== 'function') {
        throw new Error('callback is not a valid function')
      }

      this._callback = ({ data }) => {
        if (data.source === 'meson.to' && data.data && data.data.swapId) {
          callback(data.data);
        }
      };

      this.window.addEventListener('message', this._callback);
      return {
        dispose: () => {
          this.window.removeEventListener('message', this._callback);
          this._callback = null;
        }
      }
    }
  }

  return MesonTo;

}));

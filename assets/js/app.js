// We need to import the CSS so that webpack will load it.
// The MiniCssExtractPlugin is used to separate it out into
// its own CSS file.
import css from "../css/app.css"

// webpack automatically bundles all modules in your
// entry points. Those entry points can be configured
// in "webpack.config.js".
//
// Import dependencies
//
import "phoenix_html"

// Import local files
//
// Local files can be imported directly using relative paths, for example:
// import socket from "./socket"
import { Socket } from "phoenix"

class App {
  static init() {
    document.querySelector("#messages").scrollTo(0, messages.scrollHeight);
    var username = document.querySelector("#username")
    var msgBody  = document.querySelector("#message")

    // joins the channel
    let socket = new Socket("/socket", { params: { token: window.userToken } })
    socket.connect();
    socket.onClose( e => console.log("Closed connection") );

    var channel = socket.channel("room:lobby", {});

    // handle the responses
    channel.join()
      .receive( "error", (e) => console.log(e) )
      .receive( "ok",    () => console.log("Connected") )

    msgBody.addEventListener('keypress', e => {
      if (e.keyCode == 13) {
        let csrfToken = document.head.querySelector("[name~=csrf-token][content]").content;

        fetch('/', {
          method: 'POST', // or 'PUT'
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify({
            message: {
              username: username.value || 'New User',
              text: msgBody.value
            }
          }),
        })
        .then((response) => response.json())
        .then(messageJson => {
          channel.push("new:message", messageJson.data);
        })

        msgBody.value = "";
      }
    });

    channel.on("new:message", msg => this.renderMessage(msg))
  }

  static renderMessage(msg) {
    var messages = document.querySelector("#messages")

    // append the message to the page
    messages.insertAdjacentHTML('beforeend', `<p><strong>${msg.username}</strong>: ${msg.text}</p>`)
    messages.scrollTo(0, messages.scrollHeight);
  }
}

App.init()

export default App

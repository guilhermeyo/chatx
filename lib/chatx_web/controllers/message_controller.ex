defmodule ChatxWeb.MessageController do
  use ChatxWeb, :controller

  alias Chatx.Messages
  alias Chatx.Messages.Message

  def index(conn, _params) do
    messages = Messages.list_messages()
    render(conn, "index.html", messages: messages, token: get_csrf_token())
  end

  def create(conn, %{"message" => message_params}) do
    with {:ok, %Message{} = message} <- Messages.create_message(message_params) do
      render(conn, "show.json", message: message)
    end
  end
end

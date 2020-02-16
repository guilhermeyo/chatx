defmodule ChatxWeb.RoomChannel do
  use Phoenix.Channel

  def join("room:lobby", message, socket) do
    {:ok, socket}
  end

  def handle_in("new:message", msg, socket) do
    broadcast! socket, "new:message", %{username: msg["username"], text: msg["text"]}
    {:noreply, socket}
  end
end

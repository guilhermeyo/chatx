defmodule ChatxWeb.MessageView do
  use ChatxWeb, :view
  alias ChatxWeb.MessageView

  def render("show.json", %{message: message}) do
    %{data: render_one(message, MessageView, "message.json")}
  end

  def render("message.json", %{message: message}) do
    %{id: message.id,
      username: message.username,
      text: message.text}
  end
end

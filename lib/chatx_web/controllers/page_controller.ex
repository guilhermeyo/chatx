defmodule ChatxWeb.PageController do
  use ChatxWeb, :controller

  def index(conn, _params) do
    render(conn, "index.html")
  end
end

defmodule Chatx.Messages do
  import Ecto.Query, warn: false
  alias Chatx.Repo

  alias Chatx.Messages.Message

  def list_messages do
    Repo.all(Message)
  end

  def create_message(attrs \\ %{}) do
    %Message{}
    |> Message.changeset(attrs)
    |> Repo.insert()
  end
end

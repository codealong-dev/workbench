defmodule Workbench.Uploads do
  @moduledoc """
  Images in a thread's conversation: ones you attach to a message, and ones
  an agent looks at or makes (Claude reading a picture, Codex's imageView and
  imageGeneration). Stored under `<home>/uploads/<thread_id>/` and served by
  `GET /api/uploads/<thread_id>/<file>` so the timeline can show them.

  A ref is what items carry: `%{"id", "name", "mime", "url"}`. The file's path
  on disk (for the agent) comes from `path/2`.
  """

  # Claude rejects base64 images over 5 MB; the UI scales big ones down first
  @max_bytes 5 * 1024 * 1024
  @types %{"image/png" => "png", "image/jpeg" => "jpg", "image/gif" => "gif", "image/webp" => "webp"}
  @exts Map.new(@types, fn {mime, ext} -> {ext, mime} end) |> Map.put("jpeg", "image/jpeg")

  def max_bytes, do: @max_bytes

  def dir(thread_id), do: Path.join([Workbench.Home.dir(), "uploads", thread_id])

  @doc """
  Store one image: `%{"data" => base64, "mime", "name"?}` (attached or
  returned inline) or `%{"path" => file}` (an image the agent wrote or read).
  """
  def store(thread_id, %{"data" => b64, "mime" => mime} = img) when is_binary(b64) do
    with {:ok, ext} <- ext(mime),
         {:ok, bytes} <- decode(b64) do
      write(thread_id, ext, img["name"], bytes)
    end
  end

  def store(thread_id, %{"path" => path} = img) when is_binary(path) do
    with {:ok, mime} <- mime_of(path),
         {:ok, %{size: size}} when size <= @max_bytes <- File.stat(path),
         {:ok, bytes} <- File.read(path) do
      write(thread_id, @types[mime], img["name"] || Path.basename(path), bytes)
    else
      {:ok, %File.Stat{}} -> {:error, :too_large}
      err -> err
    end
  end

  def store(_thread_id, _img), do: {:error, :bad_image}

  @doc "Store several; ones that fail are skipped."
  def store_all(thread_id, images) when is_list(images) do
    for img <- images, {:ok, ref} <- [store(thread_id, img)], do: ref
  end

  def store_all(_thread_id, _), do: []

  @doc "The stored file for `file` (an id from a ref), or :error for anything else."
  def path(thread_id, file) do
    if Regex.match?(~r/\A[0-9a-f-]{36}\z/, thread_id) and Regex.match?(~r/\A[0-9a-f]{32}\.(png|jpg|gif|webp)\z/, file) do
      path = Path.join(dir(thread_id), file)
      if File.regular?(path), do: {:ok, path, mime_of!(file)}, else: :error
    else
      :error
    end
  end

  def remove_all(thread_id), do: File.rm_rf(dir(thread_id))

  defp write(thread_id, ext, name, bytes) do
    cond do
      byte_size(bytes) > @max_bytes ->
        {:error, :too_large}

      byte_size(bytes) == 0 ->
        {:error, :bad_image}

      true ->
        id = Base.encode16(:crypto.strong_rand_bytes(16), case: :lower) <> "." <> ext
        dir = dir(thread_id)
        File.mkdir_p!(dir)
        File.write!(Path.join(dir, id), bytes)

        {:ok,
         %{
           "id" => id,
           "name" => clean_name(name) || id,
           "mime" => mime_of!(id),
           "url" => "/api/uploads/#{thread_id}/#{id}"
         }}
    end
  end

  defp decode(b64) do
    case Base.decode64(b64, ignore: :whitespace) do
      {:ok, bytes} -> {:ok, bytes}
      :error -> {:error, :bad_image}
    end
  end

  defp ext(mime) do
    case @types[mime] do
      nil -> {:error, :unsupported_image}
      ext -> {:ok, ext}
    end
  end

  defp mime_of(path) do
    case @exts[path |> Path.extname() |> String.trim_leading(".") |> String.downcase()] do
      nil -> {:error, :unsupported_image}
      mime -> {:ok, mime}
    end
  end

  defp mime_of!(path), do: elem(mime_of(path), 1)

  defp clean_name(name) when is_binary(name) and name != "", do: name |> Path.basename() |> String.slice(0, 120)
  defp clean_name(_), do: nil
end

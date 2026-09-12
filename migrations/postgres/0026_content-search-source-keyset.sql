-- Put the library discriminator on the relation that drives ordered content search.
-- Without it PostgreSQL has to walk every newer document from other libraries before it
-- can return the first matching document from the requested library.

ALTER TABLE novel_documents
  ADD COLUMN source_id integer REFERENCES novel_sources(id) ON DELETE SET NULL;

UPDATE novel_documents d
SET source_id = n.source_id
FROM novels n
WHERE n.id = d.novel_id;

CREATE OR REPLACE FUNCTION set_novel_document_source_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT source_id INTO NEW.source_id FROM novels WHERE id = NEW.novel_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER novel_documents_source_id_set
BEFORE INSERT OR UPDATE OF novel_id ON novel_documents
FOR EACH ROW EXECUTE FUNCTION set_novel_document_source_id();

CREATE OR REPLACE FUNCTION propagate_novel_source_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    UPDATE novel_documents SET source_id = NEW.source_id WHERE novel_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER novels_source_id_propagate
AFTER UPDATE OF source_id ON novels
FOR EACH ROW EXECUTE FUNCTION propagate_novel_source_id();

CREATE INDEX novel_documents_source_ready_id_idx
  ON novel_documents (source_id, id DESC)
  WHERE state = 'ready' AND active_generation > 0;

ANALYZE novel_documents;

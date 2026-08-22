package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import java.util.List;

/**
 * A post-processing step that derives or transforms generated artifacts after the render stage
 * (spec §18.2 POST). Implementations MUST NOT mutate the input {@code files} list; they return a
 * new list (which may add or replace {@link OutputFile}s).
 */
public interface PostProcessor {

    /** Transforms/derives artifacts and returns a new file list. */
    List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files);
}
